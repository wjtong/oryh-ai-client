/**
 * Batch C acceptance (docs/34 §8): a real owner Host, a stand-in model that calls ORYH's generic tool,
 * and the real broker. A write the agent makes is admitted once with its session and tool call on the
 * receipt; a write the server has not opened is refused before ORYH sees it; a write whose answer never
 * comes is recorded as unknown, and the model is told to check rather than retry. Heavy (one Host,
 * about 600 MB), so it runs only when ORYH_OWNER_HOST_TEST=1.
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { OwnerBroker } from '../src/owner-broker.js'
import { startOwnerHost } from '../src/owner-host.js'
import { MemoryReceiptStore } from '../src/write-receipts.js'

const owner = 'b'.repeat(64)
const identity = { user: { id: 'u-c', email: 'c@example.test', name: 'C', role: 'member', employeeId: 'e-c' }, tenant: { id: 't-c', slug: 'c', name: 'Tenant C', environmentId: null }, permissions: ['master_data.manage'] }
/** What the stand-in model asks ORYH to do, keyed by a word in the person's message. */
const SCENARIOS: Record<string, { path: string; body: Record<string, unknown> }> = {
  WRITE: { path: '/api/v1/projects', body: { project_name: '聊天里建的项目' } },
  NOTOPEN: { path: '/api/v1/purchase-orders', body: { supplier: 'x' } },
  LOST: { path: '/api/v1/projects', body: { project_name: '没有回音的项目' } },
}

it.skipIf(process.env.ORYH_OWNER_HOST_TEST !== '1')('admits a chat write once, refuses one not opened, and records one that got no answer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oryh-chat-writes-'))
  const toolCalls: { path: string }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), path = url.pathname
    if (path === '/api/v1/auth/me') return Response.json({ data: { id: 'u-c', email: 'c@example.test', name: 'C', role: 'member', employee_id: 'e-c', tenant_id: 't-c', tenant: { slug: 'c', name: 'Tenant C' }, permissions: identity.permissions } })
    if (path !== '/mcp') return Response.json({ data: [], meta: { pages: 1 } })
    const message = JSON.parse(String(init!.body)) as { id: number; method: string; params?: { name?: string; arguments?: { path: string } } }
    const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: message.id, result })
    if (message.method === 'tools/list') return reply({ tools: [{ name: 'oryh_request', description: 'Call any oryh REST operation', inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' } }, required: ['method', 'path'] } }] })
    if (message.method !== 'tools/call') return reply({ prompts: [], resources: [] })
    toolCalls.push({ path: message.params!.arguments!.path })
    if (message.params!.arguments!.path === SCENARIOS.LOST!.path && JSON.stringify(message).includes('没有回音')) throw new TypeError('socket hang up')
    return reply({ content: [{ type: 'text', text: '{"data":{"id":"p-9"}}' }], structuredContent: { data: { id: 'p-9' } } })
  }) as typeof globalThis.fetch
  const receipts = new MemoryReceiptStore()
  const broker = new OwnerBroker({ issuer: 'https://oryh.example.test', owner, receipts, fetch, grants: () => [{ signal: new AbortController().signal, accessToken: async () => 'token' }] })

  // The stand-in model: the first step of a turn calls oryh_request for the scenario named in the prompt;
  // the step after the tool result answers in text. Every request it receives is kept.
  const modelRequests: { messages: { role: string; content?: unknown; tool_call_id?: string }[] }[] = []
  const model = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += String(chunk) })
    req.on('end', () => {
      const body = JSON.parse(raw) as { messages: { role: string; content?: unknown; tool_call_id?: string }[] }
      modelRequests.push(body)
      const send = (chunks: unknown[]) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.end('data: [DONE]\n\n')
      }
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      // The person's words are not always the last user message: the runtime appends its own context after them.
      const asked = body.messages.findLastIndex(m => m.role === 'user' && Object.keys(SCENARIOS).some(key => JSON.stringify(m.content ?? '').includes(key)))
      const name = asked === -1 ? undefined : Object.keys(SCENARIOS).find(key => JSON.stringify(body.messages[asked]!.content ?? '').includes(key))
      if (name && body.messages.slice(asked).some(m => m.role === 'tool')) {
        send([{ choices: [{ index: 0, delta: { role: 'assistant', content: '好的。' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }])
        return
      }
      if (!name) {
        // Not a turn of this test (a title or other side request): answer plainly.
        send([{ choices: [{ index: 0, delta: { role: 'assistant', content: '标题' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }])
        return
      }
      const scenario = SCENARIOS[name]!
      send([
        { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name: 'oryh_request', arguments: JSON.stringify({ method: 'POST', ...scenario }) } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage },
      ])
    })
  })
  await new Promise<void>(done => model.listen(0, '127.0.0.1', done))
  const logs: string[] = []
  const host = await startOwnerHost(owner, 1, new AbortController().signal, {
    dataRoot: join(root, 'owners'), bundles: { business: resolve('../dsh-bundle'), server: resolve('../server-bundle') }, storeMasterKey: Buffer.alloc(32, 5),
    modelEnvironment: { DEEPSEEK_API_KEY: 'stand-in', DEEPSEEK_BASE_URL: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1` },
    origin: 'https://oryh.example.test', identity, broker, writes: true, log: line => logs.push(line),
  })
  try {
    const rpc = async (namespace: string, method: string, args: Record<string, unknown>) => (await fetch_(`http://127.0.0.1:${host.value.port}/api/${namespace}/${method}`, {
      method: 'POST', headers: { cookie: host.value.internalCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: `${namespace}/${method}`, payload: { args } }) })).text()
    const created = await rpc('session', 'create', { request: {} })
    const sessionId = created.match(/"sessionId":"([^"]+)"/)![1]!
    /** Say one scenario word and wait for the tool result it produces to reach the model. */
    const turn = async (word: string) => {
      const accepted = await rpc('session', 'prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: `请执行 ${word}` }] } })
      for (let waited = 0; waited < 30_000; waited += 250) {
        const result = modelRequests.flatMap(r => r.messages).find(m => m.role === 'tool' && m.tool_call_id === `call_${word}`)
        if (result) return JSON.stringify(result.content)
        await new Promise(done => setTimeout(done, 250))
      }
      throw new Error(`no tool result for ${word}: prompt=${accepted.slice(0, 200)} model requests=${modelRequests.length} roles=${JSON.stringify(modelRequests.map(r => r.messages.map(m => m.role)))} toolMessages=${JSON.stringify(modelRequests.flatMap(r => r.messages).filter(m => m.role === 'tool' || m.role === 'assistant').slice(0, 4)).slice(0, 1500)} tools=${JSON.stringify(modelRequests.at(-1) && (modelRequests.at(-1) as { tools?: { function: { name: string } }[] }).tools?.map(t => t.function.name))} oryh=${JSON.stringify(toolCalls)} receipts=${JSON.stringify(receipts.list(owner))}\n${logs.slice(-30).join('\n')}`)
    }

    const written = await turn('WRITE')
    expect(written).toContain('p-9')
    const [receipt] = receipts.list(owner)
    expect(receipt).toMatchObject({ kind: 'chat', sessionId, callId: 'call_WRITE', operation: 'project.create', status: 'succeeded', resourceId: 'p-9' })
    expect(toolCalls).toEqual([{ path: SCENARIOS.WRITE!.path }])
    // With writes admitted, the agent is no longer told the server is read-only.
    expect(JSON.stringify(modelRequests[0])).not.toContain('目前只读')

    expect(await turn('NOTOPEN')).toContain('暂未开放')
    expect(toolCalls).toHaveLength(1)

    expect(await turn('LOST')).toContain('写入结果不明')
    expect(receipts.list(owner).find(r => r.callId === 'call_LOST')).toMatchObject({ status: 'unknown', operation: 'project.create' })
  } finally {
    await host.stop()
    model.close()
    await rm(root, { recursive: true, force: true })
  }
}, 180_000)

const fetch_ = globalThis.fetch
