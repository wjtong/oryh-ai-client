import { nativeSessionStack } from './native-session-stack.js'
import { createReadPresetAuthority, type ServerPresetAuthority } from '../src/native-preset.js'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { allocateOwnerWorkspace } from '../src/owner-workspace.js'
import { boot, initProfile, loadProfileDirectory, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '../src/profile-plugin.js'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Llm, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Session from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projection from '@deepseek-ai/dsh-session-projection'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { ServerOAuth } from '../src/oauth.js'
import { createServerReadAgent, readAgentTools } from '../src/read-agent.js'

// Deterministic model adapter: real native loop and tool execution, no external model credentials.
class ScriptedModel extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private script: Array<{ tool: string; args?: object } | string>) { super() }
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const next = this.script.shift() ?? 'Fixture done'
    if (typeof next === 'string') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: next }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: next } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else {
      const id = ToolCallId('call-'+this.requests.length), args = JSON.stringify(next.args ?? {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: next.tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: next.tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function fixture(script: ConstructorParameters<typeof ScriptedModel>[0], profile = false, authority = true, nativePreset = false, nativeController = false) {
  const root = await mkdtemp(join(tmpdir(), 'oryh-agent-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  let presetBound!: ServerPresetAuthority
  let createBound!: (ctx: Context, signal: AbortSignal) => Promise<AgentHandle>
  let ctx: Context
  let profileRows: ReturnType<typeof composeEntries> = []
  if (profile) {
    const dir = join(root, 'profile'), lab = fileURLToPath(new URL('..', import.meta.url))
    await mkdir(dir)
    initProfile(dir, ['@oryh/server-lab'], 'startup')
    await mkdir(join(dir, 'node_modules/@oryh'), { recursive: true })
    await symlink(lab, join(dir, 'node_modules/@oryh/server-lab'))
    const resolved = loadProfileDirectory('oryh-server-fixture', dir, join(lab, 'package.json'), { userLayer: false })
    const presetRoot = join(root, 'presets')
    if (nativePreset) {
      await mkdir(join(presetRoot, 'oryh-server'), { recursive: true })
      await writeFile(join(presetRoot, 'oryh-server', 'agent.cordis.yml'), '- id: oryh-native\n  name: \'@oryh/server-lab/native-preset\'\n')
    }
    const patches = [...resolved.layers.flatMap(layer => layer.patches), { id: 'session-persistence', disabled: false, config: { root: join(root, 'sessions'), compression: 'none' } }]
    if (nativePreset) patches.push({ insert: [{ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'oryh-server', roots: [{ path: presetRoot, trust: 'system' }], includeShippedRoot: false, includeUserRoot: false } }] } as never)
    profileRows = composeEntries([patches])
    const config = join(dir, 'cordis.yml'); await writeFile(config, '[]\n')
    ctx = await boot('oryh-server-fixture', config, patches, host => {
      if (nativePreset && !nativeController) host.provide('oryhServerPresetAuthority', { install: scope => presetBound.install(scope) })
      if (authority) host.provide('oryhServerAuthority', { create: (scope, signal) => createBound(scope, signal) })
    }, pathToFileURL(lab+'/').href)
  } else {
    ctx = new Context()
    await ctx.plugin(Llm); await ctx.plugin(Session); await ctx.plugin(Jsonl, { root, compression: 'none' })
    await ctx.plugin(Projection); await ctx.plugin(Prompt); await ctx.plugin(Tools); await ctx.plugin(Skills)
    await ctx.plugin(Agents); await ctx.plugin(Loop, { agents: [] }); await ctx.plugin(SkillTool)
  }
  cleanup.push(() => ctx.fiber.dispose())
  const model = new ScriptedModel(script); ctx.llm.registerAdapter(['fixture'], model)
  let owner!: Context
  await ctx.plugin({ name: 'trusted-read-agent-fixture', inject: ['agents','tools','skills','systemPrompt'], apply(scope) { owner = scope } })
  const records = new Map(), paths: string[] = []
  const oauth = new ServerOAuth({ issuer: 'https://oryh.example.test', clientId: 'https://client.example.test/client.json', callback: 'https://client.example.test/callback',
    credentials: { readRecord: async k => records.get(k), modifyRecord: async (k, change) => { const r = await change(records.get(k)); records.set(k,r); return r }, deleteRecord: async k => { records.delete(k) } },
    fetch: async input => {
      const path = new URL(String(input)).pathname; paths.push(path)
      if (path === '/oauth/revoke') return new Response(null, { status: 200 })
    if (path === '/oauth/token') return Response.json({ token_type: 'Bearer', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 })
      if (path === '/api/v1/auth/me') return Response.json({ data: { id: 'u-a', role: 'member', email: 'a@example.test', tenant_id: 't-a', tenant: { slug: 'a' }, permissions: ['master_data.manage'], employee_id: 'e-a' } })
      if (path === '/api/v1/projects') return Response.json({ data: [], meta: { total: 0 } })
      throw new Error('Unexpected request')
    } })
  const state = new URL(oauth.begin('fixture-browser-binding-at-least-32-characters', new AbortController().signal).authorizationUrl).searchParams.get('state')!
  const grant = await oauth.complete({ state, code: 'fixture', binding: 'fixture-browser-binding-at-least-32-characters' })
  const reader = { listPrompts: vi.fn(async () => ({ prompts: [{ name: 'oryh-test', description: 'Fixture project skill' }] })),
    getPrompt: vi.fn(async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Fixture project instruction' } }] })) }
  const close = vi.fn(async () => {})
  vi.spyOn(oauth, 'connectSkills').mockResolvedValue({ reader, close } as never)
  const evidence: unknown[] = []
  const workspace = await allocateOwnerWorkspace(root, grant.owner)
  createBound = (scope, signal) => createServerReadAgent(scope, oauth, grant, { workspace, model: { provider: 'fixture', model: 'fixture' }, signal }, e => evidence.push(e))
  presetBound = createReadPresetAuthority(oauth, grant, workspace, 'oryh-server')
  const start = () => nativePreset ? ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: workspace.path, agentPreset: 'oryh-server' }, setup: async scope => { await ctx.agentPresets.mount(scope, 'oryh-server') } }) : profile ? ctx.oryhServerAgents.start() : createBound(owner, new AbortController().signal)
  return { ctx, model, oauth, grant, start, paths, reader, close, evidence, profileRows, owner, workspace, root }
}
async function turn(f: Awaited<ReturnType<typeof fixture>>, handle: Awaited<ReturnType<typeof f.start>>) {
  const idle = new Promise<void>(resolve => {
    const off = f.ctx.on('agent/status', ({ agent, status }) => { if (agent === handle.agent && status === 'idle') { off(); resolve() } })
  })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Fixture: query projects' }], source: { kind: 'user' } }))
  await idle
}
it('runs the native skill loader, typed read tool and model reply, then persists the actual loop events', async () => {
  const f = await fixture([{ tool: 'skill', args: { name: 'oryh-test' } }, { tool: 'oryh_list_projects' }, 'Fixture complete'])
  const h = await f.start(); await turn(f,h)
  expect(f.reader.getPrompt).toHaveBeenCalled()
  expect(f.paths).toContain('/api/v1/projects')
  expect(f.model.requests).toHaveLength(3)
  expect(f.model.requests[0]!.tools?.map(t => t.name).sort()).toEqual([...readAgentTools].sort())
  const events = h.agent.session.snapshotEvents(), serialized = JSON.stringify(events)
  expect(serialized).toContain('Fixture complete'); expect(serialized).toContain('Fixture project instruction')
  expect(serialized).not.toContain('synthetic-access'); expect(serialized).not.toContain('synthetic-refresh')
  expect(serialized).not.toContain('mcp__oryh__oryh_request')
  const id = h.agent.id; await h.dispose()
  const reader = await f.ctx.sessionPersistence.open(id, 'read')
  try { expect((await reader.read()).events).toEqual(events) } finally { await reader.close() }
  expect(f.close).toHaveBeenCalledTimes(1)
})
it('does not execute an inherited Bash tool even when the model explicitly calls it', async () => {
  const f = await fixture([{ tool: 'bash' }, 'Unavailable'])
  const execute = vi.fn(async () => 'must never run')
  f.ctx.tools.register(defineTool({ name: 'bash', description: 'fixture trap', parameters: {}, output: { schema: { type: 'string' }, render: (_a,v) => [{ type:'text',text:v }] }, execute }))
  const h = await f.start(); await turn(f,h)
  expect(execute).not.toHaveBeenCalled()
  expect(f.model.requests[0]!.tools?.some(t => t.name === 'bash')).toBe(false)
  expect(f.paths).not.toContain('/api/v1/projects')
  await h.dispose()
})
it('revoking the grant disposes the native agent and its scoped skills', async () => {
  const f = await fixture(['done']), h = await f.start()
  expect(await f.ctx.skills.list({ scope: h.agent })).toHaveLength(1)
  await f.oauth.revoke(f.grant)
  await vi.waitFor(() => expect(f.ctx.agents.get(h.agent.id)).toBeUndefined())
  expect(await f.ctx.skills.list({ scope: h.agent })).toEqual([])
  await h.dispose()
  await expect(f.start()).rejects.toThrow()
})
it('rolls back unpublished setup when authorization is revoked during MCP initialization', async () => {
  const f = await fixture(['done'])
  let release!: () => void
  vi.mocked(f.oauth.connectSkills).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve })
    return { reader: f.reader, close: f.close } as never
  })
  const starting = f.start()
  const rejected = expect(starting).rejects.toThrow()
  await vi.waitFor(() => expect(release).toBeDefined())
  await f.oauth.revoke(f.grant); release()
  await rejected
  await vi.waitFor(() => expect(f.close).toHaveBeenCalled())
  expect(f.ctx.agents.list()).toEqual([])
  expect(await f.ctx.skills.list()).toEqual([])
  expect(f.model.requests).toHaveLength(0)
})

it('boots the external server bundle through the public Profile and Loader, runs a turn and unloads it', async () => {
  const f = await fixture([{ tool: 'oryh_list_projects' }, 'Profile reply'], true)
  expect(f.profileRows).toHaveLength(11)
  expect(f.profileRows.some(row => /bash|filesystem|directory-picker|web-app/.test(String(row.name)))).toBe(false)
  const h = await f.start(); await turn(f,h)
  expect(f.paths).toContain('/api/v1/projects')
  expect(JSON.stringify(h.agent.session.snapshotEvents())).toContain('Profile reply')
  const service = f.ctx.oryhServerAgents
  await f.ctx.fiber.dispose()
  await expect(service.start()).rejects.toThrow()
  expect(f.close).toHaveBeenCalledTimes(1)
})

it('refuses to boot the server bundle without a trusted authority', async () => {
  await expect(fixture([], true, false)).rejects.toThrow()
})
it('profile shutdown cancels a pending Agent start before it is published', async () => {
  const f = await fixture([], true)
  let release!: () => void
  vi.mocked(f.oauth.connectSkills).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve })
    return { reader: f.reader, close: f.close } as never
  })
  const starting = f.start(), rejected = expect(starting).rejects.toThrow()
  await vi.waitFor(() => expect(release).toBeDefined())
  const stopped = f.ctx.fiber.dispose(); release()
  await stopped; await rejected
  await vi.waitFor(() => expect(f.close).toHaveBeenCalled())
  expect(f.model.requests).toHaveLength(0)
})

it('rejects a browser-style workspace object before creating an Agent or calling business APIs', async () => {
  const f = await fixture([]), count = f.paths.length
  await expect(createServerReadAgent(f.owner, f.oauth, f.grant, {
    workspace: { ...f.workspace }, model: { provider: 'fixture', model: 'fixture' },
  })).rejects.toThrow('Trusted owner workspace unavailable')
  expect(f.paths).toHaveLength(count)
  expect(f.ctx.agents.list()).toEqual([])
  expect(f.model.requests).toHaveLength(0)
})

it('loads business capabilities through the real native standing preset and retains them across sessions', async () => {
  const f = await fixture([{ tool: 'oryh_list_projects' }, 'First native preset response', { tool: 'oryh_list_projects' }, 'Second native preset response'], true, true, true)
  const first = await f.start()
  await turn(f, first)
  expect(f.paths).toContain('/api/v1/projects')
  expect(f.model.requests[0]!.tools?.map(t => t.name).sort()).toEqual([...readAgentTools].sort())
  await first.dispose()
  const second = await f.start()
  expect(await f.ctx.skills.list({ scope: second.agent })).toHaveLength(1)
  await turn(f, second)
  expect(f.model.requests).toHaveLength(4)
  expect(f.paths.filter(path => path === '/api/v1/projects')).toHaveLength(2)
  await second.dispose()
  await f.oauth.revoke(f.grant)
  await expect(f.ctx.oryhServerPresetAuthority.install(f.owner)).rejects.toThrow()
})

it('refuses a native preset model step if a new unapproved inherited tool appears', async () => {
  const f = await fixture(['must not run'], true, true, true)
  const h = await f.start(), execute = vi.fn(async () => 'forbidden')
  f.ctx.tools.register(defineTool({ name: 'bash', description: 'fixture trap', parameters: {}, output: { schema: { type: 'string' }, render: (_a,v) => [{ type:'text',text:v }] }, execute }))
  await turn(f,h)
  expect(f.model.requests).toHaveLength(0)
  expect(execute).not.toHaveBeenCalled()
  await h.dispose()
})

it('creates and prompts a real native SessionController through authenticated Gateway HTTP', async () => {
  const f = await fixture([{ tool: 'oryh_list_projects' }, 'Native HTTP complete'], true, true, true, true)
  const native = await nativeSessionStack(f.ctx, f.root, { oauth: f.oauth, grant: f.grant, workspace: f.workspace, preset: 'oryh-server' })
  const rpc = async (method: string, request: object) => {
    const response = await fetch(`${native.origin}/api/session/${method}`, { method: 'POST', headers: { cookie: native.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: `session/${method}`, payload: { args: { request } } }) })
    return (await response.json()).result
  }
  const created = await rpc('create', {})
  expect(created).toMatchObject({ ok: true, value: { agentPreset: 'oryh-server' } })
  const id = created.value.sessionId
  expect(f.ctx.agents.get(SessionId(id))?.session.header.cwd).toBe(f.workspace.path)
  const prompted = await rpc('prompt', { sessionId: id, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Fixture query projects' }] })
  expect(prompted, JSON.stringify(prompted)).toMatchObject({ ok: true, value: { accepted: true } })
  await vi.waitFor(() => expect(f.model.requests).toHaveLength(2))
  expect(f.paths).toContain('/api/v1/projects')
  expect(await rpc('prompt', { sessionId: 'foreign', requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'denied' }] })).toMatchObject({ ok: false })
  expect(await rpc('create', { cwd: '/tmp' })).toMatchObject({ ok: false })
  const coldId = SessionId(randomUUID())
  const cold = await f.ctx.sessionPersistence.create({ id: coldId, version: SESSION_FORMAT_VERSION, cwd: '/tmp', agentPreset: 'oryh-server', createdAt: Date.now(), isSeeded: false })
  await cold.close()
  expect(await rpc('prompt', { sessionId: coldId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'denied cold record' }] })).toMatchObject({ ok: false })
  await f.oauth.revoke(f.grant)
  expect(await rpc('create', {})).toMatchObject({ ok: false })
})
