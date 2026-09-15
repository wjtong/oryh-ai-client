import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { connectSkillReader } from '../src/mcp-reader.js'
import { McpSkillProvider, mountMcpSkills, type SkillEvidence, type SkillReader } from '../src/mcp-skills.js'

const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture() {
  const calls: Array<{ actor: string; method: string }> = []
  const state = { denied: false, text: 'Fill a timesheet with oryh_request.', loop: false, delay: 0, redirect: '' }
  const server = createServer(async (req, res) => {
    if (state.redirect) { res.writeHead(307, { location: state.redirect }); res.end(); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c))
    const rpc = JSON.parse(Buffer.concat(chunks).toString())
    const actor = req.headers.authorization === 'Bearer fixture-A' ? 'A' : req.headers.authorization === 'Bearer fixture-B' ? 'B' : 'unknown'
    calls.push({ actor, method: rpc.method })
    if (actor === 'unknown' || state.denied) { res.writeHead(401); res.end('private upstream diagnostic fixture-A'); return }
    if (rpc.id === undefined) { res.writeHead(202); res.end(); return }
    if (state.delay && rpc.method === 'prompts/get') await new Promise(resolve => setTimeout(resolve, state.delay))
    const uri = 'oryh://skills/oryh-timesheet-submit/references/api.md'
    const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { prompts: {}, resources: {} }, serverInfo: { name: 'oryh-fixture', version: '1' } }
      : rpc.method === 'prompts/list' ? { prompts: [{ name: 'oryh-timesheet-submit', description: `Timesheets ${actor}` }], ...(state.loop ? { nextCursor: 'same' } : {}) }
      : rpc.method === 'prompts/get' ? { messages: [{ role: 'user', content: { type: 'text', text: `${actor}: ${state.text}` } }] }
      : rpc.method === 'resources/list' ? { resources: [{ uri, name: 'api', mimeType: 'text/markdown' }] }
      : rpc.method === 'resources/read' ? { contents: [{ uri, mimeType: 'text/markdown', text: `${actor} reference` }] } : {}
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address')
  const endpoint = `http://127.0.0.1:${address.port}/mcp`
  async function connect(actor: string) {
    const abort = new AbortController()
    const token = vi.fn(async () => `fixture-${actor}`)
    const connection = await connectSkillReader({ endpoint, accessToken: token, signal: abort.signal, allowLoopbackForTest: true })
    cleanup.push(connection.close)
    const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
    await ctx.plugin(SkillRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    const evidence: SkillEvidence[] = []
    let mounted!: ReturnType<typeof mountMcpSkills>
    const plugin = await ctx.plugin({ name: `oryh-mcp-${actor}`, inject: ['skills', 'tools'], apply(scope) {
      mounted = mountMcpSkills(scope, connection.reader, e => evidence.push(e))
    } })
    return { ctx, mounted, evidence, abort, plugin, token }
  }
  return { state, calls, connect, endpoint }
}

it('uses real SDK HTTP and public Harness skill registry; owners and evidence stay separate', async () => {
  const f = await fixture(), a = await f.connect('A'), b = await f.connect('B')
  expect((await a.ctx.skills.list())[0]?.description).toBe('Timesheets A')
  expect((await b.ctx.skills.list())[0]?.description).toBe('Timesheets B')
  const skill = await a.ctx.skills.get('oryh-timesheet-submit')
  expect(skill?.content).toContain('mcp__oryh__oryh_request')
  expect(skill?.content).toContain('A: Fill')
  expect(await b.mounted.provider.readReference('oryh-timesheet-submit', 'references/api.md')).toBe('B reference')
  expect(a.evidence[0]?.hash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify([skill, a.evidence, b.evidence])).not.toContain('fixture-')
  expect(f.calls.some(c => c.method === 'tools/call')).toBe(false)
  expect(a.token.mock.calls.length).toBeGreaterThan(1)
})

it('reloads prompt bodies and invalidates summaries at the trusted refresh boundary', async () => {
  const f = await fixture(), a = await f.connect('A')
  await a.ctx.skills.get('oryh-timesheet-submit')
  const before = f.calls.filter(c => c.method === 'prompts/list').length
  f.state.text = 'Updated instruction'
  a.mounted.provider.refresh()
  expect((await a.ctx.skills.get('oryh-timesheet-submit'))?.content).toContain('Updated instruction')
  expect(f.calls.filter(c => c.method === 'prompts/list').length).toBeGreaterThan(before)
  expect(a.evidence[0]?.hash).not.toBe(a.evidence[1]?.hash)
})

it('cached skill summaries cannot bypass revoked server authorization or leak error details', async () => {
  const f = await fixture(), a = await f.connect('A')
  await a.ctx.skills.list(); f.state.denied = true
  await expect(a.ctx.skills.get('oryh-timesheet-submit')).rejects.toThrow('ORYH MCP skills unavailable')
  expect(a.evidence).toEqual([])
})

it('rejects traversal, arbitrary URLs, unlisted references and foreign candidate handles', async () => {
  const f = await fixture(), a = await f.connect('A'), b = await f.connect('B')
  for (const path of ['../api.md', 'https://evil/a.md', 'scripts/a.md', 'references/%2e%2e/a.md', 'references/missing.md']) {
    await expect(a.mounted.provider.readReference('oryh-timesheet-submit', path)).rejects.toThrow()
  }
  const candidate = (await a.mounted.provider.list())[0]!
  await expect(b.mounted.provider.get(candidate)).rejects.toThrow()
  await expect(a.mounted.provider.get({ ...candidate, locator: {} })).rejects.toThrow()
  expect(f.calls.some(c => c.method === 'resources/read')).toBe(false)
})

it('revocation discards in-flight content and stops subsequent network calls', async () => {
  const f = await fixture(), a = await f.connect('A')
  const candidate = (await a.mounted.provider.list())[0]!
  f.state.delay = 100
  const loading = a.mounted.provider.get(candidate)
  a.mounted.provider.revoke()
  await expect(loading).rejects.toThrow()
  const count = f.calls.length
  await expect(a.mounted.provider.list()).rejects.toThrow()
  expect(f.calls.length).toBe(count); expect(a.evidence).toEqual([])
})

it('plugin disposal unregisters the native skill and refuses old provider calls', async () => {
  const f = await fixture(), a = await f.connect('A')
  expect(await a.ctx.skills.list()).toHaveLength(1)
  await a.plugin.dispose()
  expect(await a.ctx.skills.list()).toEqual([])
  await expect(a.mounted.provider.list()).rejects.toThrow()
})

it('bounds repeated pagination cursors', async () => {
  const f = await fixture(), a = await f.connect('A'); f.state.loop = true
  await expect(a.mounted.provider.list()).rejects.toThrow()
  expect(f.calls.filter(c => c.method === 'prompts/list')).toHaveLength(2)
})

it('does not forward credentials through redirects', async () => {
  const f = await fixture()
  const accessToken = vi.fn(async () => 'fixture-A')
  f.state.redirect = 'http://127.0.0.1:1/credential-trap'
  await expect(connectSkillReader({ endpoint: f.endpoint, accessToken, signal: new AbortController().signal, allowLoopbackForTest: true })).rejects.toThrow('ORYH MCP connection failed')
})

it('rejects untrusted endpoints before requesting credentials', async () => {
  const accessToken = vi.fn(async () => 'never')
  for (const endpoint of ['http://example.com/mcp', 'https://a:b@example.com/mcp', 'https://example.com/mcp?token=x', 'https://example.com/else']) {
    await expect(connectSkillReader({ endpoint, accessToken, signal: new AbortController().signal })).rejects.toThrow('Invalid trusted')
  }
  expect(accessToken).not.toHaveBeenCalled()
})

it('rejects nontext or assistant-role prompts rather than injecting them as skills', async () => {
  const control = { signal: new AbortController().signal, invalidate: vi.fn() }
  const reader = {
    listPrompts: async () => ({ prompts: [{ name: 'oryh-test', description: 'test' }] }),
    getPrompt: async () => ({ messages: [{ role: 'assistant', content: { type: 'text', text: 'bad' } }] }),
  } as unknown as SkillReader
  const provider = new McpSkillProvider(reader, control, vi.fn())
  const candidate = (await provider.list())[0] as SkillCandidate
  await expect(provider.get(candidate)).rejects.toThrow()
})
