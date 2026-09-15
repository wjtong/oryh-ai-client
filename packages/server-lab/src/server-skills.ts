/** Trusted per-grant skill capability for the read-only server pilot. */
import type { Context } from '@deepseek-ai/cordis'
import { samePrincipal, type ConnectionId, type OryhSkillService, type SkillPrincipal } from '@oryh/ai-client-core'
import { mountMcpSkills, type SkillReader, type SkillEvidence } from './mcp-skills.js'

export interface ServerSkillBinding {
  readonly connectionId: ConnectionId
  readonly principal: SkillPrincipal
  readonly signal: AbortSignal
  readonly reader: SkillReader
  readonly record: (evidence: SkillEvidence) => void
}

/** Call inside the intended Harness scope; never reconstruct this binding from Remote arguments. */
export function mountServerSkills(ctx: Context, binding: ServerSkillBinding) {
  binding.signal.throwIfAborted()
  const principal = Object.freeze({ ...binding.principal }), id = binding.connectionId
  const lifetime = new AbortController()
  const signal = AbortSignal.any([binding.signal, lifetime.signal])
  const mounted = mountMcpSkills(ctx, binding.reader, binding.record, true)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    lifetime.abort()
    binding.signal.removeEventListener('abort', dispose)
    mounted.dispose()
  }
  binding.signal.addEventListener('abort', dispose, { once: true })
  ctx.effect(() => dispose, 'oryh server skills')
  if (binding.signal.aborted) { dispose(); binding.signal.throwIfAborted() }
  const service: OryhSkillService = {
    delivery: 'mcp',
    syncDescription: '从当前服务器授权的 ORYH MCP 连接刷新技能目录。只刷新技能，不下载文件、不修改业务数据，也不改变当前身份。',
    identityContext(expected) {
      if (signal.aborted) return 'ORYH 服务器授权已失效，请重新登录；当前技能不可使用。'
      if (expected && !samePrincipal(principal, expected)) return 'ORYH MCP 技能身份与本会话企业身份不一致。停止业务操作并重新关联会话；刷新技能不会切换身份。'
      return `ORYH MCP 技能属于：${principal.tenantName} · ${principal.email}，由服务器连接绑定${expected ? '，与本会话企业身份一致' : ''}。当前为只读试点，不能保存、提交或审批。`
    },
    async sync(connectionId) {
      if (connectionId !== id || signal.aborted) throw new Error('ORYH skill connection unavailable; sign in again.')
      mounted.provider.refresh()
      const skills = (await mounted.provider.list({ signal })).map(skill => skill.name)
      signal.throwIfAborted()
      return { delivery: 'mcp', skills, message: '已刷新当前授权的 MCP 技能目录。' }
    },
  }
  return { service, dispose, provider: mounted.provider }
}
