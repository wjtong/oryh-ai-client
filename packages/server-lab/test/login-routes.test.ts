import { afterEach, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ServerOAuth } from '../src/oauth.js'
import { mountLoginRoutes, type RuntimeLease } from '../src/login-routes.js'
import { RuntimePool } from '../src/runtime-pool.js'
import { startNativeRuntime } from '../src/native-runtime.js'
import { processRuntimeFactory } from '../src/process-runtime.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const origin = 'https://client.example.test'
async function setup(realPool = false, processBase?: string, multiple = false) {
  const pool = realPool ? new RuntimePool({ start: processBase ? processRuntimeFactory(processBase) : startNativeRuntime, capacity: 2, idleMs: 0 }) : undefined
  if (pool) cleanup.push(() => pool.close())
  const records = new Map<CredentialKey, CredentialRecord>()
  const credentials = {
    readRecord: async (k: CredentialKey) => records.get(k),
    modifyRecord: async (k: CredentialKey, fn: (r: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => { const r = await fn(records.get(k)); if (r) records.set(k, r); return r },
    deleteRecord: async (k: CredentialKey) => { records.delete(k) },
  }
  const state = { user: 'u-a', tenant: 't-a', wrongOwner: false, failStart: false, time: 100_000, pause: undefined as Promise<void> | undefined }
  const transport = vi.fn(async (url: string | URL | Request) => {
    return String(url).endsWith('/oauth/token') ? Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600 }) : Response.json({ data: { id: state.user, email: `${state.user}@example.test`, role: 'member', tenant_id: state.tenant, tenant: { slug: state.tenant } } })
  }) as typeof fetch
  const oauth = new ServerOAuth({ issuer: 'https://oryh.example.test', clientId: `${origin}/client.json`, callback: `${origin}/oryh/auth/callback`, credentials, fetch: transport })
  const other = new ServerOAuth({ issuer: 'https://self-hosted.example.test', clientId: `${origin}/client.json`, callback: `${origin}/oryh/auth/callback`, credentials, fetch: transport })
  const configured = multiple ? [{ id: 'primary', label: 'Primary', oauth }, { id: 'custom', label: 'Self hosted', oauth: other }] : oauth
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const leases: Array<RuntimeLease & { controller: AbortController }> = []
  let routes!: ReturnType<typeof mountLoginRoutes>
  const plugin = await ctx.plugin({ name: 'oryh-p0-login', inject: ['webServer'], apply(scope) {
    routes = mountLoginRoutes(scope, configured, { publicOrigin: origin, now: () => state.time, sessionTtlMs: 60_000, acquire: async (grant, signal) => {
      if (pool) return pool.acquire(grant.owner, signal)
      await state.pause
      if (state.failStart) throw new Error('private startup secret')
      const controller = new AbortController()
      const lease = { owner: state.wrongOwner ? 'wrong-owner' : grant.owner, generation: 1, signal: controller.signal,
        controller, release: vi.fn(async () => { controller.abort() }) }
      leases.push(lease)
      // A factory may retain the supplied cancellation signal throughout the lease.
      signal.addEventListener('abort', () => controller.abort(), { once: true })
      if (signal.aborted) controller.abort()
      return lease
    } })
  } })
  // A protected test route uses the exact same trusted session admission as future runtime routing.
  ctx.webServer.register({ kind: 'exact', path: '/protected', handler: async (req, res) => {
    try { const live = routes.authorize(req)
      if (pool) { const target = pool.resolve(live.runtime); const reply = await fetch(`http://127.0.0.1:${target.port}/api/p0-runtime`, { headers: { cookie: target.internalCookie }, signal: live.signal }); res.writeHead(reply.status); res.end(await reply.text()) }
      else res.end(JSON.stringify({ owner: live.runtime.owner, generation: live.runtime.generation })) }
    catch { res.writeHead(403); res.end('Forbidden') }
  } })
  function call(path: string, headers: Record<string, string> = {}, method = 'GET') {
    return new Promise<{ status: number; body: string; cookies: string[]; location?: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: ctx.webServer.port, path, method, headers: { host: 'client.example.test', ...headers } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), cookies: res.headers['set-cookie'] ?? [], ...(res.headers.location ? { location: res.headers.location } : {}) }))
      }); req.on('error', reject); req.end()
    })
  }
  async function begin(server?: string) {
    const response = await call('/oryh/auth/login' + (server ? `?server=${server}` : ''))
    const loginCookie = response.cookies[0]!.split(';')[0]!
    return { response, loginCookie, state: new URL(response.location!).searchParams.get('state')! }
  }
  async function login(previous?: string) {
    const b = await begin()
    const response = await call(`/oryh/auth/callback?state=${b.state}&code=synthetic-code`, { cookie: `${b.loginCookie}${previous ? `; ${previous}` : ''}` })
    return { ...b, response, cookie: response.cookies.find(c => c.startsWith('__Host-oryh-session='))?.split(';')[0] ?? '' }
  }
  return { call, begin, login, records, leases, state, plugin, transport }
}

it('composes real Harness routes and establishes a credential-free browser session bound to its runtime', async () => {
  const f = await setup(), login = await f.login()
  expect(login.response.status).toBe(303); expect(login.response.location).toBe('/')
  expect(login.response.cookies.every(c => c.includes('HttpOnly; Secure; SameSite=Lax'))).toBe(true)
  expect(login.response.cookies.some(c => c.includes('Domain='))).toBe(false)
  expect(login.response.cookies.join('')).not.toContain('synthetic-')
  const session = await f.call('/oryh/auth/session', { cookie: login.cookie })
  expect(session.status).toBe(200); expect(session.body).not.toContain('synthetic-')
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(200)
  expect(f.leases[0]?.signal.aborted).toBe(false)
  const metadata = await f.call('/client.json')
  expect(JSON.parse(metadata.body).redirect_uris).toEqual([`${origin}/oryh/auth/callback`])
})

it('rejects callback duplicates, injected tenant, and a copied callback without the bound cookie', async () => {
  const f = await setup(), b = await f.begin()
  for (const suffix of [`state=${b.state}&state=other&code=x`, `state=${b.state}&code=x&tenant=t-b`]) {
    expect((await f.call(`/oryh/auth/callback?${suffix}`, { cookie: b.loginCookie })).status).toBe(403)
  }
  expect((await f.call(`/oryh/auth/callback?state=${b.state}&code=x`)).status).toBe(403)
  expect(f.records.size).toBe(0); expect(f.transport).not.toHaveBeenCalled()
})

it('rejects callback replay and does not issue another runtime lease', async () => {
  const f = await setup(), login = await f.login()
  expect((await f.call(`/oryh/auth/callback?state=${login.state}&code=x`, { cookie: login.loginCookie })).status).toBe(403)
  expect(f.leases).toHaveLength(1)
})

it('requires exact origin for logout and keeps the session alive after cross-site attempts', async () => {
  const f = await setup(), login = await f.login()
  for (const headers of [{}, { origin: 'https://evil.test' }]) {
    expect((await f.call('/oryh/auth/logout', { cookie: login.cookie, ...headers }, 'POST')).status).toBe(403)
  }
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(200)
  expect((await f.call('/oryh/auth/logout', { cookie: login.cookie, origin }, 'POST')).status).toBe(204)
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(403)
  expect(f.records.size).toBe(0); expect(f.leases[0]?.release).toHaveBeenCalledTimes(1)
})

it('rejects host spoofing, forwarded headers, duplicate cookies and cross-origin reads', async () => {
  const f = await setup(), login = await f.login()
  for (const headers of [{ host: 'other.example.test' }, { 'x-forwarded-host': 'client.example.test' }, { cookie: `${login.cookie}; ${login.cookie}` }, { origin: 'https://evil.test' }]) {
    expect((await f.call('/protected', { cookie: login.cookie, ...headers })).status).toBe(403)
  }
})

it('rotates the session after re-login; stale cookie and its runtime lease stop working', async () => {
  const f = await setup(), a = await f.login(); f.state.tenant = 't-b'
  const b = await f.login(a.cookie)
  expect(b.cookie).not.toBe(a.cookie)
  expect((await f.call('/protected', { cookie: a.cookie })).status).toBe(403)
  expect((await f.call('/protected', { cookie: b.cookie })).status).toBe(200)
  expect(f.leases[0]?.owner).not.toBe(f.leases[1]?.owner)
  expect(f.leases[0]?.signal.aborted).toBe(true)
})

it('runtime invalidation expires the browser session and deletes its grant', async () => {
  const f = await setup(), login = await f.login()
  f.leases[0]!.controller.abort()
  await vi.waitFor(() => expect(f.records.size).toBe(0))
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(403)
})

it('session expiry refuses access even before the cleanup timer runs', async () => {
  const f = await setup(), login = await f.login(); f.state.time += 60_001
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(403)
  await vi.waitFor(() => expect(f.records.size).toBe(0))
})

it('runtime startup failure or wrong owner never creates a browser session', async () => {
  const f = await setup(); f.state.failStart = true
  const failed = await f.login(); expect(failed.response.status).toBe(403); expect(f.records.size).toBe(0)
  f.state.failStart = false; f.state.wrongOwner = true
  expect((await f.login()).response.status).toBe(403)
  expect(f.records.size).toBe(0); expect(f.leases[0]?.release).toHaveBeenCalledTimes(1)
})

it('logout while a callback starts a runtime cannot create a late session', async () => {
  const f = await setup(), b = await f.begin()
  let release!: () => void
  f.state.pause = new Promise<void>(resolve => { release = resolve })
  const callback = f.call(`/oryh/auth/callback?state=${b.state}&code=x`, { cookie: b.loginCookie })
  await vi.waitFor(() => expect(f.records.size).toBe(1))
  await f.call('/oryh/auth/logout', { cookie: b.loginCookie, origin }, 'POST')
  release()
  expect((await callback).status).toBe(403)
  expect(f.records.size).toBe(0)
})

it('plugin disposal removes login routes and revokes existing sessions', async () => {
  const f = await setup(), login = await f.login()
  await f.plugin.dispose()
  expect((await f.call('/oryh/auth/login')).status).toBe(404)
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(403)
  expect(f.records.size).toBe(0); expect(f.leases[0]?.release).toHaveBeenCalledTimes(1)
})

it('concurrent callback retries cannot cancel the first valid login', async () => {
  const f = await setup(), b = await f.begin()
  let release!: () => void
  f.state.pause = new Promise<void>(resolve => { release = resolve })
  const path = `/oryh/auth/callback?state=${b.state}&code=x`
  const first = f.call(path, { cookie: b.loginCookie })
  await vi.waitFor(() => expect(f.records.size).toBe(1))
  expect((await f.call(path, { cookie: b.loginCookie })).status).toBe(403)
  release()
  expect((await first).status).toBe(303)
  expect(f.leases).toHaveLength(1); expect(f.leases[0]?.signal.aborted).toBe(false)
})

it('connects login sessions to real pooled Harness Hosts without sharing browser grants', async () => {
  const f = await setup(true), a = await f.login(), a2 = await f.login()
  const first = await f.call('/protected', { cookie: a.cookie })
  expect(first.status).toBe(200)
  expect((await f.call('/protected', { cookie: a2.cookie })).body).toBe(first.body)
  f.state.tenant = 't-b'; const b = await f.login()
  const second = await f.call('/protected', { cookie: b.cookie })
  expect(second.status).toBe(200); expect(second.body).not.toBe(first.body)
  await f.call('/oryh/auth/logout', { cookie: a.cookie, origin }, 'POST')
  expect((await f.call('/protected', { cookie: a.cookie })).status).toBe(403)
  expect((await f.call('/protected', { cookie: a2.cookie })).status).toBe(200)
  expect((await f.call('/protected', { cookie: b.cookie })).status).toBe(200)
  expect(f.records.size).toBe(2)
})

it('admits a browser login into a subprocess Host and closes it on logout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oryh-login-process-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const f = await setup(true, root), login = await f.login()
  expect(login.response.status).toBe(303)
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(200)
  await f.call('/oryh/auth/logout', { cookie: login.cookie, origin }, 'POST')
  expect((await f.call('/protected', { cookie: login.cookie })).status).toBe(403)
  expect(f.records.size).toBe(0)
}, 30_000)

it('pins each login to its configured server and isolates identical tenant/user IDs across servers', async () => {
  const f = await setup(false, undefined, true)
  const list = await f.call('/oryh/auth/servers')
  expect(JSON.parse(list.body).map((s: { origin: string }) => s.origin)).toEqual(['https://oryh.example.test', 'https://self-hosted.example.test'])
  expect(list.body).not.toContain('synthetic-')
  const a = await f.login()
  const aSession = JSON.parse((await f.call('/oryh/auth/session', { cookie: a.cookie })).body)
  const b = await f.begin('custom')
  expect(new URL(b.response.location!).origin).toBe('https://self-hosted.example.test')
  const wrongIssuer = await f.call(`/oryh/auth/callback?state=${b.state}&code=synthetic&iss=https://oryh.example.test`, { cookie: b.loginCookie })
  expect(wrongIssuer.status).toBe(403)
  const result = await f.call(`/oryh/auth/callback?state=${b.state}&code=synthetic&iss=https://self-hosted.example.test`, { cookie: b.loginCookie })
  expect(result.status).toBe(303)
  const cookie = result.cookies.find(c => c.startsWith('__Host-oryh-session='))!.split(';')[0]!
  const bSession = JSON.parse((await f.call('/oryh/auth/session', { cookie })).body)
  expect(bSession.server.origin).toBe('https://self-hosted.example.test')
  expect(bSession.owner).not.toBe(aSession.owner)
  expect((await f.call('/oryh/auth/session', { cookie: a.cookie })).status).toBe(200)
  expect(await f.call('/oryh/auth/logout', { cookie, origin }, 'POST')).toMatchObject({ status: 204 })
  expect(vi.mocked(f.transport).mock.calls.some(([url]) => String(url) === 'https://self-hosted.example.test/oauth/revoke')).toBe(true)
  expect((await f.call('/oryh/auth/session', { cookie: a.cookie })).status).toBe(200)
  for (const path of ['/oryh/auth/login?server=https://arbitrary.invalid', '/oryh/auth/login?server=custom&server=primary', '/oryh/auth/login?issuer=https://arbitrary.invalid']) {
    expect((await f.call(path)).status).toBe(403)
  }
})
