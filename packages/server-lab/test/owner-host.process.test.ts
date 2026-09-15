/**
 * Boots a real owner Host (the dsh launcher with the oryh-server Profile). Heavy: one Host process
 * takes about 600 MB, so it runs only when ORYH_OWNER_HOST_TEST=1.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { DelegatedResponse, OryhRequest } from '@oryh/ai-client-core'
import { startOwnerHost } from '../src/owner-host.js'

const owner = 'a'.repeat(64)
const identity = { user: { id: 'u-a', email: 'a@example.test', name: 'A', role: 'member', employeeId: 'e-a' }, tenant: { id: 't-a', slug: 'a', name: 'Tenant A', environmentId: null }, permissions: ['timesheet.submit_own'] }
const me = { data: { id: 'u-a', email: 'a@example.test', name: 'A', role: 'member', employee_id: 'e-a', tenant_id: 't-a', tenant: { slug: 'a', name: 'Tenant A' }, permissions: ['timesheet.submit_own'] } }

it.skipIf(process.env.ORYH_OWNER_HOST_TEST !== '1')('serves one owner through the real Profile, with admission and brokered ORYH access', async () => {
  const dataRoot = join(await mkdtemp(join(tmpdir(), 'oryh-owner-host-')), 'owners')
  const sent: OryhRequest[] = []
  const logs: string[] = []
  const broker = { send: async (request: OryhRequest): Promise<DelegatedResponse> => {
    sent.push(request)
    if (request.path === '/auth/me') return { status: 200, body: me }
    if (request.root) {
      const body = request.body as { id: number; method: string } | { id: number; method: string }[]
      const answer = (m: { id: number; method: string }) => ({ jsonrpc: '2.0', id: m.id, result: { tools: [], prompts: [], resources: [] } })
      return { status: 200, body: Array.isArray(body) ? body.map(answer) : answer(body) }
    }
    return { status: 200, body: { data: [], meta: { pages: 1 } } }
  } }
  // A stand-in model endpoint: it records the request an agent turn sends, which carries the agent's tool catalog.
  const modelRequests: { path: string; body: string }[] = []
  const model = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += String(chunk) })
    req.on('end', () => { modelRequests.push({ path: req.url ?? '', body }); res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"stand-in model"}}') })
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  const modelUrl = `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`
  const lifetime = new AbortController()
  const host = await startOwnerHost(owner, 1, lifetime.signal, {
    dataRoot, bundles: { business: resolve('../dsh-bundle'), server: resolve('../server-bundle') }, storeMasterKey: Buffer.alloc(32, 9),
    modelEnvironment: { DEEPSEEK_API_KEY: 'test-model-key', DEEPSEEK_BASE_URL: modelUrl }, origin: 'https://oryh.example.test', identity, broker,
    traceAdmission: true, log: line => logs.push(line),
  })
  try {
    const origin = `http://127.0.0.1:${host.value.port}`
    const rpc = async (namespace: string, method: string, args: Record<string, unknown> = {}) => {
      const response = await fetch(`${origin}/api/${namespace}/${method}`, { method: 'POST', headers: { cookie: host.value.internalCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `${namespace}-${method}`, method: `${namespace}/${method}`, payload: { args } }) })
      return response.text()
    }
    expect((await fetch(origin, { headers: { cookie: host.value.internalCookie } })).status).toBe(200)
    expect((await fetch(origin)).status).toBe(401)
    const connections = await rpc('oryh', 'listConnections')
    expect(connections).toContain('t-a')
    for (const [namespace, method, args] of [['credentials', 'set', { ref: 'DEEPSEEK_API_KEY', value: 'x' }], ['dynamicCordisRunner', 'inventory', {}], ['agentPresets', 'list', {}], ['settings', 'mutate', { ns: 'llm-deepseek', ops: [], expectedRevision: null }]] as const) {
      // Refused by admission, or not mounted on a server Host at all.
      expect(await rpc(namespace, method, args)).toMatch(/not available on the ORYH server|not found/)
    }
    expect(sent.some(r => r.path === '/auth/me')).toBe(true)
    // A session runs the server preset, and its agent gets the client's tool policy without error.
    const created = await rpc('session', 'create', { request: {} })
    const sessionId = created.match(/"sessionId":"([^"]+)"/)?.[1]
    expect(created).toContain('oryh-server')
    await rpc('session', 'prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: '我的工时' }] } })
    for (let waited = 0; waited < 20_000 && !modelRequests.some(r => r.body.includes('"tools"')); waited += 250) await new Promise(resolve => setTimeout(resolve, 250))
    expect(logs.join('\n')).not.toMatch(/restrict\(\) names unknown|failed to apply/)
    const turn = modelRequests.find(r => r.body.includes('"tools"'))
    expect(turn, 'the agent turn reached the model').toBeDefined()
    const tools = (JSON.parse(turn!.body).tools as { function: { name: string } }[]).map(t => t.function.name).sort()
    console.log(`agent tools: ${tools.join(', ')}`)
    expect(tools).toContain('skill')
    expect(tools).toContain('oryh_current_page')
    for (const forbidden of ['bash', 'pwsh', 'read_file', 'write_file', 'edit_file', 'web_fetch', 'web_search', 'subagent', 'workflow']) expect(tools).not.toContain(forbidden)
    expect(turn!.body).not.toContain('secret')
    const rssMb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(host.value.pid)]).toString().trim()) / 1024
    console.log(`owner Host RSS ${rssMb.toFixed(0)} MB`)
    console.log(logs.slice(-40).join('\n'))
  } finally {
    await host.stop()
    model.close()
    await expect(stat(join(dataRoot, owner, '.host-lock'))).rejects.toThrow()
    await rm(join(dataRoot, '..'), { recursive: true, force: true })
  }
}, 180_000)
