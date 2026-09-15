/** Fixed native preset entry. Its authority is injected by the trusted owner Host, never browser config. */
import type { Context } from '@deepseek-ai/cordis'
import type { LoginGrant, ServerOAuth } from './oauth.js'
import { requireOwnerWorkspace, type OwnerWorkspace } from './owner-workspace.js'
import { mountServerReadCapabilities } from './read-agent.js'
export interface ServerPresetAuthority { install(ctx: Context): Promise<void> }
declare module '@deepseek-ai/cordis' { interface Context { oryhServerPresetAuthority: ServerPresetAuthority } }
export const name = 'oryh-server-native-preset'
export const inject = ['oryhServerPresetAuthority', 'tools', 'skills', 'systemPrompt']
export async function apply(ctx: Context): Promise<void> { await ctx.oryhServerPresetAuthority.install(ctx) }

/** One authorization generation. The owner supervisor must stop this Host on grant termination. */
export function createReadPresetAuthority(oauth: ServerOAuth, grant: LoginGrant, workspace: OwnerWorkspace, preset: string, lifetime?: AbortSignal): ServerPresetAuthority {
  if (!preset.trim()) throw new Error('Fixed server preset required')
  return { async install(ctx) {
    const path = await requireOwnerWorkspace(workspace, grant.owner)
    const signal = AbortSignal.any([oauth.signal(grant), ...(lifetime ? [lifetime] : [])])
    signal.throwIfAborted()
    const runtime = await oauth.createReadRuntime(grant)
    const [connection] = await runtime.host.connections()
    if (!connection) throw new Error('ORYH connection unavailable')
    await mountServerReadCapabilities(ctx, runtime, connection.id, signal,
      agent => agent.session.header.cwd === path && agent.session.header.agentPreset === preset, undefined, true)
    signal.throwIfAborted()
  } }
}
