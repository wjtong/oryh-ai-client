/** Owner-local assembly for the public native Session/Workspace/Gateway stack. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-persistence-jsonl'
import { requireOwnerWorkspace, type OwnerWorkspace } from './owner-workspace.js'
import { createReadPresetAuthority } from './native-preset.js'
import { nativeAdmission } from './native-admission.js'
import type { LoginGrant, ServerOAuth } from './oauth.js'
export interface NativeOwnerAuthority {
  readonly oauth: ServerOAuth
  readonly grant: LoginGrant
  readonly workspace: OwnerWorkspace
  readonly preset: string
}
declare module '@deepseek-ai/cordis' { interface Context { oryhNativeOwner: NativeOwnerAuthority } }
export const name = 'oryh-native-owner-binding'
export const inject = ['oryhNativeOwner', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'agents']
/** Requires an already isolated owner Host and persistence root; does not provide browser authentication. */
export async function apply(ctx: Context): Promise<void> {
  const { oauth, grant, workspace, preset } = ctx.oryhNativeOwner
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'oryh native binding lifetime')
  const path = await requireOwnerWorkspace(workspace, grant.owner)
  const signal = AbortSignal.any([oauth.signal(grant), lifetime.signal])
  signal.throwIfAborted()
  const registered = await ctx.workspaceRegistry.create(path, '我的工作区')
  ctx.provide('oryhServerPresetAuthority', createReadPresetAuthority(oauth, grant, workspace, preset, signal))
  ctx.provide('oryhGatewayAdmission', nativeAdmission({ owner: grant.owner, workspace, workspaceId: registered.id, preset, signal,
    sessionMetadata: async id => {
      signal.throwIfAborted()
      const attached = ctx.sessions.get(SessionId(id))
      if (attached) return attached.header
      try {
        const metadata = await ctx.sessionPersistence.stat(SessionId(id), { signal })
        signal.throwIfAborted()
        return metadata?.header
      } catch { return undefined }
    },
  }))
  // Authorization lifetime closes gateway calls/streams and interrupts active model turns.
  // The supervisor still owns full Host disposal; the preset is not an OAuth grant pool.
  const cancel = () => { for (const agent of ctx.agents.list()) agent.cancel({ kind: 'user' }, { keepInbox: false }) }
  ctx.effect(() => {
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    return () => { lifetime.abort(); signal.removeEventListener('abort', cancel) }
  }, 'oryh native authorization lifetime')
  signal.throwIfAborted()
}
