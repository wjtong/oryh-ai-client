/** External plugin entry for the server read-only pilot. No HTTP endpoint or credential config. */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence-jsonl'

export interface ServerAgentAuthority {
  create(ctx: Context, signal: AbortSignal): Promise<AgentHandle>
}
export interface ServerAgents { start(): Promise<AgentHandle> }
declare module '@deepseek-ai/cordis' {
  interface Context { oryhServerAuthority: ServerAgentAuthority; oryhServerAgents: ServerAgents }
}
export const name = 'oryh-server-read-profile'
export const inject = ['oryhServerAuthority', 'agents', 'tools', 'skills', 'systemPrompt', 'sessionPersistence']
export function apply(ctx: Context): void {
  const lifetime = new AbortController(), handles = new Set<AgentHandle>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.all([...handles].map(handle => handle.dispose()))
    handles.clear()
  }, 'oryh server profile lifetime')
  ctx.provide('oryhServerAgents', {
    async start() {
      lifetime.signal.throwIfAborted()
      const handle = await ctx.oryhServerAuthority.create(ctx, lifetime.signal)
      if (lifetime.signal.aborted) { await handle.dispose(); lifetime.signal.throwIfAborted() }
      handles.add(handle)
      return { agent: handle.agent, dispose: async () => { await handle.dispose(); handles.delete(handle) } }
    },
  })
}
