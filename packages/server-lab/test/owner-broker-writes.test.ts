import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { operationDigest, type OryhRequest } from '@oryh/ai-client-core'
import { OwnerBroker } from '../src/owner-broker.js'
import { MemoryReceiptStore } from '../src/write-receipts.js'

const issuer = 'https://oryh.example.test'
const owner = 'a'.repeat(64)

/** ORYH answering writes as the test says; every request it receives is recorded. */
function setup(answer: (url: string, init: RequestInit) => Response | Promise<Response> = () => Response.json({ data: { id: 'res-1' } }, { status: 201 })) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init! })
    // ORYH lists its tools without annotations.
    if (String(init?.body ?? '').includes('"tools/list"')) return Response.json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'oryh_request' }, { name: 'upload_attachment' }] } })
    return answer(String(input), init!)
  }) as unknown as typeof globalThis.fetch
  let now = 1_000_000
  const receipts = new MemoryReceiptStore()
  const broker = new OwnerBroker({ issuer, owner, receipts, grants: () => [{ signal: new AbortController().signal, accessToken: async () => 'token' }], fetch, now: () => now })
  return { broker, calls, receipts, advance: (ms: number) => { now += ms }, now: () => now }
}
const signal = () => new AbortController().signal

/** A page write as a domain service sends it after the person confirmed. */
function pageWrite(f: ReturnType<typeof setup>, request: { method: 'POST' | 'PATCH' | 'DELETE'; path: `/${string}`; body?: unknown }, operationId = randomUUID()): OryhRequest {
  return { ...request, operation: { kind: 'page', operationId, digest: operationDigest(request), confirmedAt: f.now() } }
}
/** A chat write: ORYH's generic tool, as the agent called it. */
function chatWrite(args: Record<string, unknown>, operationId = randomUUID()): OryhRequest {
  return { path: '/mcp', root: true, method: 'POST', body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'oryh_request', arguments: args } },
    operation: { kind: 'chat', operationId, sessionId: 'session-1', callId: 'call-1' } }
}
const mcpResult = (result: unknown) => Response.json({ jsonrpc: '2.0', id: 7, result })

describe('broker writes', () => {
  it('sends a confirmed page write once, with its receipt and idempotency key', async () => {
    const f = setup()
    const request = pageWrite(f, { method: 'POST', path: '/timesheet-headers/h1/submit', body: { source: 'web' } }, 'op-page-1')
    await expect(f.broker.send(request, signal())).resolves.toMatchObject({ status: 201 })
    expect((f.calls[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('op-page-1')
    expect(f.receipts.get('op-page-1')).toMatchObject({ owner, kind: 'page', operation: 'timesheet.submit', path: '/timesheet-headers/h1/submit', status: 'succeeded', oryhStatus: 201, resourceId: 'res-1' })
    await expect(f.broker.send(request, signal())).rejects.toThrow('已经发送过')
    expect(f.calls).toHaveLength(1)
  })

  it('refuses a page write that is undescribed, changed since confirmation, expired, or not opened — before sending', async () => {
    const f = setup()
    await expect(f.broker.send({ method: 'POST', path: '/timesheet-headers', body: {} }, signal())).rejects.toThrow('缺少服务器要求的写入描述')
    const confirmed = pageWrite(f, { method: 'POST', path: '/timesheet-headers', body: { period_start: '2026-09-07' } })
    await expect(f.broker.send({ ...confirmed, body: { period_start: '2026-09-14' } }, signal())).rejects.toThrow('与确认时不一致')
    const late = pageWrite(f, { method: 'POST', path: '/projects', body: { project_name: 'P' } })
    f.advance(301_000)
    await expect(f.broker.send(late, signal())).rejects.toThrow('确认已过期')
    await expect(f.broker.send(pageWrite(f, { method: 'POST', path: '/sales-orders', body: {} }), signal())).rejects.toThrow('暂未开放')
    await expect(f.broker.send(pageWrite(f, { method: 'POST', path: '/approval-records', body: { entity_type: 'sales_order' } }), signal())).rejects.toThrow('暂未开放')
    expect(f.calls).toHaveLength(0)
    expect(f.receipts.list(owner)).toEqual([])
  })

  it('lets a chat write through without a confirmation of its own, carrying the key as the tool argument', async () => {
    const f = setup(() => mcpResult({ content: [{ type: 'text', text: '{}' }], structuredContent: { data: { id: 'th-9' } } }))
    await f.broker.send(chatWrite({ method: 'POST', path: '/api/v1/timesheet-headers', body: { period_start: '2026-09-07' } }, 'op-chat-1'), signal())
    const sent = JSON.parse(String(f.calls[0]!.init.body))
    expect(sent.params.arguments).toMatchObject({ method: 'POST', path: '/api/v1/timesheet-headers', idempotency_key: 'op-chat-1' })
    expect(f.receipts.get('op-chat-1')).toMatchObject({ kind: 'chat', sessionId: 'session-1', callId: 'call-1', operation: 'timesheet.create', path: '/timesheet-headers', status: 'succeeded', resourceId: 'th-9' })
  })

  it('refuses chat writes that are undescribed, not opened, page-only, or batched with other calls', async () => {
    const f = setup()
    const undescribed = chatWrite({ method: 'POST', path: '/timesheet-headers', body: {} })
    await expect(f.broker.send({ ...undescribed, operation: undefined } as OryhRequest, signal())).rejects.toThrow('缺少服务器要求的写入描述')
    await expect(f.broker.send(chatWrite({ method: 'POST', path: '/purchase-orders', body: {} }), signal())).rejects.toThrow('暂未开放')
    await expect(f.broker.send(chatWrite({ method: 'POST', path: '/attachments', body: { content_base64: 'AA==' } }), signal())).rejects.toThrow('暂未开放')
    const upload = { ...chatWrite({}), body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'upload_attachment', arguments: {} } } }
    await expect(f.broker.send(upload, signal())).rejects.toThrow('暂未开放')
    const write = chatWrite({ method: 'POST', path: '/timesheet-headers', body: {} })
    const batched = { ...write, body: [(write.body as object), { jsonrpc: '2.0', id: 8, method: 'tools/list' }] }
    await expect(f.broker.send(batched, signal())).rejects.toThrow('不在服务器版开放的范围内')
    // A chat description on a REST call, or a page description on a tool call, is not how either path writes.
    const crossed = { method: 'POST' as const, path: '/timesheet-headers' as const, body: {}, operation: { kind: 'chat' as const, operationId: 'x', sessionId: 's', callId: 'c' } }
    await expect(f.broker.send(crossed, signal())).rejects.toThrow('不在服务器版开放的范围内')
    expect(f.calls.filter(c => c.url.endsWith('/mcp') && String(c.init.body).includes('tools/call'))).toHaveLength(0)
  })

  it('settles receipts from what ORYH answered: refused, unknown, or no answer at all', async () => {
    const rejected = setup(() => Response.json({ detail: 'period already covered' }, { status: 409 }))
    await expect(rejected.broker.send(pageWrite(rejected, { method: 'POST', path: '/timesheet-headers', body: {} }, 'op-409'), signal())).resolves.toMatchObject({ status: 409 })
    expect(rejected.receipts.get('op-409')).toMatchObject({ status: 'rejected', oryhStatus: 409 })

    const failing = setup(() => new Response('upstream', { status: 502 }))
    await failing.broker.send(pageWrite(failing, { method: 'POST', path: '/projects', body: {} }, 'op-502'), signal())
    expect(failing.receipts.get('op-502')).toMatchObject({ status: 'unknown', oryhStatus: 502 })

    const silent = setup(() => { throw new TypeError('socket hang up') })
    await expect(silent.broker.send(pageWrite(silent, { method: 'POST', path: '/expense-claims', body: {} }, 'op-lost'), signal())).rejects.toThrow('写入结果不明')
    expect(silent.receipts.get('op-lost')).toMatchObject({ status: 'unknown' })
    await expect(silent.broker.send(pageWrite(silent, { method: 'POST', path: '/expense-claims', body: {} }, 'op-lost'), signal())).rejects.toThrow('已经发送过')

    const toolRefused = setup(() => mcpResult({ isError: true, content: [], structuredContent: { detail: 'not allowed' } }))
    await toolRefused.broker.send(chatWrite({ method: 'POST', path: '/timesheet-headers/h1/submit', body: {} }, 'op-tool-4xx'), signal())
    expect(toolRefused.receipts.get('op-tool-4xx')).toMatchObject({ status: 'rejected' })
    const toolFailed = setup(() => mcpResult({ isError: true, content: [{ type: 'text', text: 'HTTP 500' }] }))
    await toolFailed.broker.send(chatWrite({ method: 'POST', path: '/timesheet-headers/h1/submit', body: {} }, 'op-tool-5xx'), signal())
    expect(toolFailed.receipts.get('op-tool-5xx')).toMatchObject({ status: 'unknown' })
  })

  it('stays read-only without a receipt store, and still admits validation runs', async () => {
    const readOnly = new OwnerBroker({ issuer, grants: () => [{ signal: new AbortController().signal, accessToken: async () => 'token' }], fetch: (async () => Response.json({ meta: { validate_only: true } })) as never })
    const f = setup()
    await expect(readOnly.send(pageWrite(f, { method: 'POST', path: '/timesheet-headers', body: {} }), signal())).rejects.toThrow('服务器版目前只读')
    await expect(readOnly.send({ method: 'POST', path: '/timesheet-headers?validate_only=true', body: {} }, signal())).resolves.toMatchObject({ status: 200 })
  })
})
