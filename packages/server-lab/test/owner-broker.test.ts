import { describe, expect, it, vi } from 'vitest'
import { OwnerBroker, type BrokerGrant } from '../src/owner-broker.js'

const issuer = 'https://oryh.example.test'
function setup(options: { tools?: { name: string; readOnly: boolean }[] } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init! })
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (body?.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: (options.tools ?? []).map(t => ({ name: t.name, annotations: { readOnlyHint: t.readOnly } })) } })
    }
    if (String(input).endsWith('/api/v1/projects/p1')) return Response.json({ detail: 'project p1 already archived' }, { status: 409 })
    return Response.json({ data: [] })
  }) as unknown as typeof globalThis.fetch
  const abort = new AbortController()
  const grant: BrokerGrant = { signal: abort.signal, accessToken: vi.fn(async () => 'secret-access-token') }
  const grants: BrokerGrant[] = [grant]
  const broker = new OwnerBroker({ issuer, grants: () => grants, fetch })
  return { broker, calls, grant, grants, abort }
}
const signal = () => new AbortController().signal
const rpc = (method: string, params?: unknown) => ({ path: '/mcp' as const, root: true, method: 'POST' as const, body: { jsonrpc: '2.0', id: 1, method, params } })

describe('the owner broker', () => {
  it('sends reads to the pinned issuer with the grant token, and hands back ORYH status and body', async () => {
    const f = setup()
    await expect(f.broker.send({ path: '/timesheet-headers?employee_id=e&page=1&size=100' }, signal())).resolves.toEqual({ status: 200, body: { data: [] } })
    expect(f.calls[0]!.url).toBe(`${issuer}/api/v1/timesheet-headers?employee_id=e&page=1&size=100`)
    expect((f.calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('secret-access-token')
    expect(f.calls[0]!.init.redirect).toBe('error')
    await expect(f.broker.send({ path: '/projects/p1' }, signal())).resolves.toMatchObject({ status: 409 })
    await expect(f.broker.send({ path: '/openapi.json', root: true }, signal())).resolves.toMatchObject({ status: 200 })
  })

  it('refuses writes before anything reaches ORYH, with a reason people can read', async () => {
    const f = setup()
    for (const request of [{ path: '/timesheet-headers', method: 'POST' }, { path: '/projects/p1', method: 'PATCH', body: {} }, { path: '/projects/p1', method: 'DELETE' }, { path: '/projects', body: {} }] as const) {
      await expect(f.broker.send(request as never, signal())).rejects.toThrow('服务器版目前只读')
    }
    expect(f.calls).toHaveLength(0)
    // A validation run writes nothing and is let through; a second, contradicting flag is not.
    await expect(f.broker.send({ path: '/timesheet-headers?validate_only=true', method: 'POST', body: {} }, signal())).resolves.toMatchObject({ status: 200 })
    await expect(f.broker.send({ path: '/timesheet-headers/h1?validate_only=true', method: 'PATCH', body: {} }, signal())).resolves.toMatchObject({ status: 200 })
    for (const path of ['/timesheet-headers?validate_only=true&validate_only=false', '/timesheet-headers?validate_only=1', '/timesheet-headers/h1/submit']) {
      await expect(f.broker.send({ path: path as `/${string}`, method: 'POST', body: {} }, signal())).rejects.toThrow('服务器版目前只读')
    }
    await expect(f.broker.send({ path: '/timesheet-headers/h1?validate_only=true', method: 'DELETE' }, signal())).rejects.toThrow('服务器版目前只读')
  })

  it('refuses credential paths, other roots, traversal and encoded separators', async () => {
    const f = setup()
    for (const request of [{ path: '/my/skill-bundle' }, { path: '/auth/token/refresh' }, { path: '/api-keys' }, { path: '/oauth/token', root: true }, { path: '//elsewhere.test/x' }, { path: '/projects/../auth/token' }, { path: '/projects/%2e%2e/x' }, { path: '/docs', root: true }]) {
      await expect(f.broker.send(request as never, signal())).rejects.toThrow('不在服务器版开放的范围内')
    }
    await expect(f.broker.send({ path: '/auth/me' }, signal())).resolves.toMatchObject({ status: 200 })
    expect(f.calls).toHaveLength(1)
  })

  it('lets MCP discovery, skill reads and read-only tools through, judging oryh_request per call', async () => {
    const f = setup({ tools: [{ name: 'oryh_list', readOnly: true }, { name: 'upload_attachment', readOnly: false }, { name: 'oryh_request', readOnly: true }] })
    for (const request of [rpc('tools/list'), rpc('prompts/get', { name: 'oryh-a' }), rpc('resources/read', { uri: 'oryh://skills/a/x.md' }),
      rpc('tools/call', { name: 'oryh_list', arguments: { collection: 'projects' } }), rpc('tools/call', { name: 'oryh_request', arguments: { method: 'GET', path: '/api/v1/projects' } })]) {
      await expect(f.broker.send(request, signal())).resolves.toMatchObject({ status: 200 })
    }
    // ORYH lists its tools without annotations: its reads are known by name, anything else is a write.
    const unannotated = setup({ tools: [] })
    for (const name of ['oryh_detail', 'oryh_get', 'oryh_list', 'setup_report']) {
      await expect(unannotated.broker.send(rpc('tools/call', { name, arguments: { collection: 'timesheet-headers', id: 'h1' } }), signal())).resolves.toMatchObject({ status: 200 })
    }
    await expect(unannotated.broker.send(rpc('tools/call', { name: 'some_new_tool', arguments: {} }), signal())).rejects.toThrow('服务器版目前只读')
    await expect(f.broker.send(rpc('tools/call', { name: 'upload_attachment', arguments: {} }), signal())).rejects.toThrow('服务器版目前只读')
    await expect(f.broker.send(rpc('tools/call', { name: 'oryh_request', arguments: { method: 'POST', path: '/timesheet-headers/h1/submit' } }), signal())).rejects.toThrow('服务器版目前只读')
    await expect(f.broker.send(rpc('tools/call', { name: 'oryh_request', arguments: { method: 'GET', path: '/my/skill-bundle' } }), signal())).rejects.toThrow('不在服务器版开放的范围内')
    await expect(f.broker.send({ ...rpc('tools/list'), body: [rpc('tools/list').body, rpc('tools/call', { name: 'upload_attachment' }).body] }, signal())).rejects.toThrow('服务器版目前只读')
    await expect(f.broker.send(rpc('sampling/createMessage'), signal())).rejects.toThrow('不在服务器版开放的范围内')
  })

  it('stops sending once the person has no live grant, and moves to a remaining one', async () => {
    const f = setup()
    const second: BrokerGrant = { signal: new AbortController().signal, accessToken: async () => 'second-token' }
    f.grants.push(second)
    f.abort.abort()
    await f.broker.send({ path: '/auth/me' }, signal())
    expect((f.calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('second-token')
    f.grants.splice(0)
    await expect(f.broker.send({ path: '/auth/me' }, signal())).rejects.toThrow('ORYH 登录已结束')
  })
})
