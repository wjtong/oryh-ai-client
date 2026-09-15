import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { connectionId } from '@oryh/ai-client-core'
import { mountServerSkills } from '../src/server-skills.js'
import type { SkillReader } from '../src/mcp-skills.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function fixture() {
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
  let owner!: Context
  await ctx.plugin({ name: 'server-skill-fixture', inject: ['skills', 'tools'], apply(scope) { owner = scope } })
  function mount(user: string) {
    const key = {}, scope = createScope(owner, key), abort = new AbortController()
    const principal = { origin: 'https://oryh.example.test', tenantId: 't-a', userId: user, employeeId: 'e-'+user, tenantName: 'Fixture', email: user+'@example.test' }
    const reader = {
      listPrompts: vi.fn(async () => ({ prompts: [{ name: 'oryh-test', description: user }] })),
      getPrompt: vi.fn(async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Read '+user } }] })),
    } as unknown as SkillReader
    const mounted = mountServerSkills(scope.ctx, { connectionId: connectionId(user), principal, signal: abort.signal, reader, record: vi.fn() })
    return { key, scope, abort, principal, reader, ...mounted }
  }
  return { ctx, mount }
}
it('refreshes MCP through the shared capability with no installation path or ZIP result', async () => {
  const f = await fixture(), a = f.mount('a')
  expect(a.service.delivery).toBe('mcp')
  const result = await a.service.sync(connectionId('a'), true)
  expect(result).toEqual({ delivery: 'mcp', skills: ['oryh-test'], message: '已刷新当前授权的 MCP 技能目录。' })
  expect(result).not.toHaveProperty('root'); expect(result).not.toHaveProperty('installed')
  expect(a.service.identityContext(a.principal)).toContain('身份一致')
  expect(a.service.identityContext(a.principal)).toContain('只读试点')
})
it('uses native Harness scope layers without leaking either catalog to siblings or the host', async () => {
  const f = await fixture(), a = f.mount('a'), b = f.mount('b')
  expect(await f.ctx.skills.list()).toEqual([])
  expect((await f.ctx.skills.list({ scope: a.key }))[0]?.description).toBe('a')
  expect((await f.ctx.skills.get('oryh-test', { scope: b.key }))?.content).toContain('Read b')
  await a.scope.dispose()
  expect(await f.ctx.skills.list({ scope: a.key })).toEqual([])
  expect(await f.ctx.skills.list({ scope: b.key })).toHaveLength(1)
  await expect(a.service.sync(connectionId('a'))).rejects.toThrow()
})
it('rejects foreign connection IDs before network access and reports identity mismatch', async () => {
  const f = await fixture(), a = f.mount('a'), b = f.mount('b')
  await expect(a.service.sync(connectionId('b'))).rejects.toThrow()
  expect(a.reader.listPrompts).not.toHaveBeenCalled()
  expect(a.service.identityContext(b.principal)).toContain('不一致')
  // Caller mutations must not change the trusted principal retained by the capability.
  a.principal.userId = 'changed'
  expect(a.service.identityContext(a.principal)).toContain('不一致')
})
it('revoking one grant unregisters its provider and leaves another grant usable', async () => {
  const f = await fixture(), a = f.mount('a'), b = f.mount('b')
  await a.service.sync(connectionId('a'))
  a.abort.abort()
  expect(a.service.identityContext()).toContain('已失效')
  await expect(a.service.sync(connectionId('a'))).rejects.toThrow()
  expect(await f.ctx.skills.list({ scope: a.key })).toEqual([])
  expect((await b.service.sync(connectionId('b'))).skills).toEqual(['oryh-test'])
})
it('drops a delayed skill refresh after plugin disposal even if the reader ignores cancellation', async () => {
  const f = await fixture(), a = f.mount('a')
  let release!: () => void
  vi.mocked(a.reader.listPrompts).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve })
    return { prompts: [] }
  })
  const refreshing = a.service.sync(connectionId('a'))
  await vi.waitFor(() => expect(release).toBeDefined())
  await a.scope.dispose(); release()
  await expect(refreshing).rejects.toThrow()
})
