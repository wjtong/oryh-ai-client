import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ServerOAuth, type LoginGrant } from '../src/oauth.js'

function setup(issuer = 'https://oryh.example.test') {
  const records = new Map<CredentialKey, CredentialRecord>()
  const requests: Array<{ path: string; init: RequestInit }> = []
  let time = 100_000, refreshes = 0
  const state = { reject: false, tenant: 't-a', user: 'u-a', lifetime: 3600, pause: undefined as Promise<void> | undefined }
  const credentials = {
    readRecord: async (key: CredentialKey) => records.get(key),
    modifyRecord: async (key: CredentialKey, mutate: (r: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const record = await mutate(records.get(key)); if (record) records.set(key, record); else records.delete(key); return record
    },
    deleteRecord: async (key: CredentialKey) => { records.delete(key) },
  }
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    requests.push({ path, init: init! })
    if (state.reject) return new Response('private access token server diagnostic', { status: 400 })
    if (path === '/oauth/revoke') return new Response(null, { status: 200 })
    if (path === '/oauth/token') {
      const p = new URLSearchParams(String(init?.body))
      if (p.get('grant_type') === 'refresh_token') { refreshes++; await state.pause }
      return Response.json({ token_type: 'Bearer', access_token: `synthetic-access-${refreshes}`, refresh_token: `synthetic-refresh-${refreshes}`, expires_in: state.lifetime })
    }
    if (path === '/api/v1/auth/me') return Response.json({ data: {
      id: state.user, email: 'user@example.test', role: 'member', tenant_id: state.tenant,
      tenant: { slug: state.tenant, name: 'Fixture' }, permissions: ['timesheet.read', 'master_data.manage'],
    } })
    if (path === '/api/v1/projects') return Response.json({ data: [], meta: { total: 0 } })
    throw new Error('unexpected target')
  }) as typeof fetch
  const oauth = new ServerOAuth({ issuer, allowLoopbackForTest: issuer.startsWith('http://127.0.0.1:'), clientId: 'https://client.example.test/client.json',
    callback: 'https://client.example.test/oauth/callback', credentials, fetch: fetcher, now: () => time })
  const binding = 'browser-binding-with-32-random-bytes-for-test'
  function begin() {
    const abort = new AbortController()
    const url = new URL(oauth.begin(binding, abort.signal).authorizationUrl)
    return { state: url.searchParams.get('state')!, url, abort }
  }
  async function login() { return oauth.complete({ state: begin().state, code: 'synthetic-code', binding }) }
  return { oauth, records, requests, fetcher, state, binding, begin, login, advance: (ms: number) => { time += ms }, refreshes: () => refreshes }
}

it('binds PKCE, callback and resource; stores secrets only through the credential seam', async () => {
  const f = setup(), started = f.begin()
  expect(started.url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(started.url.searchParams.get('scope')).toBeNull()
  const grant = await f.oauth.complete({ state: started.state, code: 'synthetic-code', binding: f.binding })
  const posted = new URLSearchParams(String(f.requests[0]?.init.body))
  expect(createHash('sha256').update(posted.get('code_verifier')!).digest('base64url')).toBe(started.url.searchParams.get('code_challenge'))
  expect(posted.get('redirect_uri')).toBe('https://client.example.test/oauth/callback')
  expect(posted.get('resource')).toBe('https://oryh.example.test/mcp')
  expect(grant.identity.tenant.id).toBe('t-a'); expect(f.records.size).toBe(1)
  expect(JSON.stringify(grant)).not.toContain('synthetic-')
  expect(f.requests.every(r => r.init.redirect === 'error')).toBe(true)
})

it('rejects mismatched browser binding without spending the rightful login', async () => {
  const f = setup(), started = f.begin()
  await expect(f.oauth.complete({ state: started.state, code: 'code', binding: 'another-browser' })).rejects.toThrow()
  expect(f.requests).toHaveLength(0)
  await f.oauth.complete({ state: started.state, code: 'code', binding: f.binding })
})

it('spends callback once, including concurrent callbacks', async () => {
  const f = setup(), started = f.begin(), input = { state: started.state, code: 'code', binding: f.binding }
  const results = await Promise.allSettled([f.oauth.complete(input), f.oauth.complete(input)])
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(f.requests.filter(r => r.path === '/oauth/token')).toHaveLength(1)
})

it('rejects expired, cancelled, denied, and unknown callbacks without token requests', async () => {
  const f = setup(), expired = f.begin(); f.advance(600_001)
  await expect(f.oauth.complete({ state: expired.state, code: 'code', binding: f.binding })).rejects.toThrow()
  const cancelled = f.begin(); cancelled.abort.abort()
  await expect(f.oauth.complete({ state: cancelled.state, code: 'code', binding: f.binding })).rejects.toThrow()
  await expect(f.oauth.complete({ state: f.begin().state, error: 'denied', binding: f.binding })).rejects.toThrow()
  await expect(f.oauth.complete({ state: 'unknown', code: 'code', binding: f.binding })).rejects.toThrow()
  expect(f.requests).toEqual([])
})

it('isolates tenants and users and rejects forged or foreign grant handles', async () => {
  const f = setup(), a = await f.login()
  f.state.tenant = 't-b'; const b = await f.login()
  f.state.user = 'u-b'; const c = await f.login()
  expect(new Set([a.owner, b.owner, c.owner]).size).toBe(3)
  await expect(f.oauth.accessToken({ ...a })).rejects.toThrow()
  await expect(setup().oauth.accessToken(a)).rejects.toThrow()
  expect(Object.isFrozen(a.identity.tenant)).toBe(true)
  await f.oauth.revoke(a)
  await expect(f.oauth.accessToken(a)).rejects.toThrow()
  expect(await f.oauth.accessToken(b)).toBe('synthetic-access-0')
})

it('serializes simultaneous refreshes and uses the rotated record next time', async () => {
  const f = setup(), grant = await f.login(); f.advance(3_590_000)
  const tokens = await Promise.all(Array.from({ length: 20 }, () => f.oauth.accessToken(grant)))
  expect(new Set(tokens)).toEqual(new Set(['synthetic-access-1']))
  expect(f.refreshes()).toBe(1)
  expect(await f.oauth.accessToken(grant)).toBe('synthetic-access-1')
  expect(JSON.stringify([...f.records.values()])).not.toContain('synthetic-refresh-0')
})

it('logout during refresh cannot restore deleted credentials or yield a token', async () => {
  const f = setup(), grant = await f.login(); f.advance(3_590_000)
  let release!: () => void
  f.state.pause = new Promise<void>(resolve => { release = resolve })
  const refreshing = f.oauth.accessToken(grant)
  await vi.waitFor(() => expect(f.refreshes()).toBe(1))
  await f.oauth.revoke(grant); release()
  await expect(refreshing).rejects.toThrow()
  expect(f.records.size).toBe(0)
  await expect(f.oauth.accessToken(grant)).rejects.toThrow()
})

it('refresh identity drift revokes the local grant', async () => {
  const f = setup(), grant = await f.login(); f.advance(3_590_000); f.state.tenant = 'another-tenant'
  await expect(f.oauth.accessToken(grant)).rejects.toThrow()
  expect(f.records.size).toBe(0)
})

it('failed refresh does not retry or pass upstream diagnostics to callers', async () => {
  const f = setup(), grant = await f.login(); f.advance(3_590_000); f.state.reject = true
  await expect(f.oauth.accessToken(grant)).rejects.toThrow('ORYH authorization unavailable; sign in again.')
  const count = f.requests.length
  await expect(f.oauth.accessToken(grant)).rejects.toThrow()
  expect(f.requests.length).toBe(count); expect(f.records.size).toBe(0)
})

it('does not persist tokens if identity validation fails', async () => {
  const f = setup(); f.state.user = ''
  await expect(f.login()).rejects.toThrow()
  expect(f.records.size).toBe(0)
})

it('cannot recover a serialized grant or expose credentials through a login result', async () => {
  const f = setup(), grant = await f.login()
  await expect(f.oauth.accessToken(JSON.parse(JSON.stringify(grant)) as LoginGrant)).rejects.toThrow()
  expect(Object.keys(grant).sort()).toEqual(['identity', 'owner'])
})

it('feeds OAuth-owned rotating credentials into a real MCP SDK connection and stops it on logout', async () => {
  const { createServer } = await import('node:http')
  const { connectSkillReader } = await import('../src/mcp-reader.js')
  const authorizations: string[] = []
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const rpc = JSON.parse(Buffer.concat(chunks).toString())
    authorizations.push(req.headers.authorization ?? '')
    if (rpc.id === undefined) { res.writeHead(202); res.end(); return }
    const result = rpc.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { prompts: {}, resources: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { prompts: [{ name: 'oryh-test', description: 'Fixture skill' }] }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address')
  const f = setup(`http://127.0.0.1:${address.port}`), grant = await f.login()
  let connection: Awaited<ReturnType<typeof connectSkillReader>> | undefined
  try {
    connection = await f.oauth.connectSkills(grant)
    expect((await connection.reader.listPrompts()).prompts).toHaveLength(1)
    f.advance(3_590_000)
    await connection.reader.listPrompts()
    expect(authorizations).toContain('Bearer synthetic-access-0')
    expect(authorizations).toContain('Bearer synthetic-access-1')
    await f.oauth.revoke(grant)
    const count = authorizations.length
    await expect(connection.reader.listPrompts()).rejects.toThrow()
    expect(authorizations.length).toBe(count)
  } finally {
    await connection?.close()
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  }
})

it('uses OAuth for existing business reads, rotates credentials and stops on logout', async () => {
  const f = setup(), grant = await f.login(), host = await f.oauth.createReadHost(grant)
  const [connection] = await host.connections()
  await host.executeProjects(connection!.id)
  f.advance(3_590_000)
  await host.executeProjects(connection!.id)
  expect(f.requests.filter(r => r.path === '/api/v1/projects').map(r => new Headers(r.init.headers).get('authorization')))
    .toEqual(['Bearer synthetic-access-0', 'Bearer synthetic-access-1'])
  await f.oauth.revoke(grant)
  const count = f.requests.length
  await expect(host.executeProjects(connection!.id)).rejects.toThrow()
  expect(f.requests).toHaveLength(count)
  expect(f.requests.every(r => ['/oauth/token', '/oauth/revoke', '/api/v1/auth/me', '/api/v1/projects'].includes(r.path))).toBe(true)
})

it('binds the read Host and scoped MCP capability to the same trusted login', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: SkillRegistry } = await import('@deepseek-ai/dsh-skill')
  const { default: Tools } = await import('@deepseek-ai/dsh-tools')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const f = setup(), grant = await f.login(), runtime = await f.oauth.createReadRuntime(grant)
  const close = vi.fn(async () => {})
  const reader = { listPrompts: vi.fn(async () => ({ prompts: [{ name: 'oryh-test', description: 'Fixture' }] })) }
  // MCP wire behavior is covered by the SDK integration test above; this checks runtime wiring.
  const connect = vi.spyOn(f.oauth, 'connectSkills').mockResolvedValue({ reader, close } as never)
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    let mounted!: Awaited<ReturnType<typeof runtime.mountSkills>>
    const plugin = await ctx.plugin({ name: 'read-runtime-skills', inject: ['skills', 'tools'], async apply(scope) {
      mounted = await runtime.mountSkills(scope, vi.fn())
    } })
    const [connection] = await runtime.host.connections()
    expect(connect).toHaveBeenCalledWith(grant)
    expect((await mounted.service.sync(connection!.id)).skills).toEqual(['oryh-test'])
    await runtime.host.executeProjects(connection!.id)
    await f.oauth.revoke(grant)
    await expect(mounted.service.sync(connection!.id)).rejects.toThrow()
    await expect(runtime.host.executeProjects(connection!.id)).rejects.toThrow()
    await plugin.dispose()
    expect(close).toHaveBeenCalledTimes(1)
  } finally { await ctx.fiber.dispose() }
})

it('revokes the current pair at the issuer and deduplicates concurrent disconnects', async () => {
  const f = setup(), grant = await f.login(); f.advance(3_590_000)
  await f.oauth.accessToken(grant)
  await Promise.all([f.oauth.revoke(grant), f.oauth.revoke(grant)])
  const calls = f.requests.filter(r => r.path === '/oauth/revoke')
  expect(calls).toHaveLength(1)
  expect(new URLSearchParams(String(calls[0]!.init.body)).get('token')).toBe('synthetic-refresh-1')
  expect(calls[0]!.init.redirect).toBe('error')
  expect(f.records.size).toBe(0)
})
it('reports remote revocation failure while still ending local access and deleting credentials', async () => {
  const f = setup(), grant = await f.login(); f.state.reject = true
  await expect(f.oauth.revoke(grant)).rejects.toThrow('ORYH authorization unavailable')
  expect(f.records.size).toBe(0)
  await expect(f.oauth.accessToken(grant)).rejects.toThrow()
})
