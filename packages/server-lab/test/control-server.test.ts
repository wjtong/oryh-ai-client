import { createServer, request, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { startControlServer } from '../src/control-server.js'
import type { OwnerBroker } from '../src/owner-broker.js'
import { MemoryReceiptStore } from '../src/write-receipts.js'

const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

const issuer = 'https://oryh.example.test'
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

/** ORYH as the control server sees it: codes name the user who signed in. */
function oryh() {
  const tokens = new Map<string, string>()
  const revoked: string[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const form = new URLSearchParams(String(init?.body ?? ''))
    if (url.pathname === '/oauth/token') {
      const user = form.get('code')!
      tokens.set(`access-${user}`, user)
      return Response.json({ token_type: 'Bearer', access_token: `access-${user}`, refresh_token: `refresh-${user}`, expires_in: 3600 })
    }
    if (url.pathname === '/oauth/revoke') { revoked.push(form.get('token')!); return new Response(null, { status: 200 }) }
    const headers = (init?.headers ?? {}) as Record<string, string>
    const user = tokens.get(headers['x-api-key'] ?? String(headers.authorization ?? '').replace('Bearer ', ''))
    if (!user) return Response.json({ detail: 'unauthorized' }, { status: 401 })
    if (url.pathname === '/api/v1/auth/me') return Response.json({ data: { id: user, email: `${user}@example.test`, role: 'member', employee_id: `e-${user}`, tenant_id: 't-1', tenant: { slug: 't1', name: 'T1' }, permissions: [] } })
    return Response.json({ data: [{ user }] })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, revoked }
}

/** Stand-in owner Hosts: each answers with who it serves and what reached it, and echoes over WebSocket. */
function hosts() {
  const started: { owner: string; server: Server; stopped: boolean; broker: OwnerBroker }[] = []
  const startHost = vi.fn(async (owner: string, _generation: number, _signal: AbortSignal, session: { broker: OwnerBroker }) => {
    const server = createServer(async (req, res) => {
      if (req.url === '/broker-write') {
        const answer = await session.broker.send({ path: '/mcp', root: true, method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'oryh_request', arguments: { method: 'POST', path: '/projects', body: { project_name: 'P' } } } },
          operation: { kind: 'chat', operationId: 'op-control-1', sessionId: 's', callId: 'c' } }, new AbortController().signal).catch((error: Error) => ({ status: 0, body: error.message }))
        res.end(JSON.stringify(answer)); return
      }
      if (req.url === '/broker') {
        const answer = await session.broker.send({ path: '/projects' }, new AbortController().signal)
        res.end(JSON.stringify(answer.body)); return
      }
      res.setHeader('set-cookie', 'dsh-auth-leak=1')
      res.end(JSON.stringify({ owner, cookie: req.headers.cookie, host: req.headers.host, path: req.url }))
    })
    const wss = new WebSocketServer({ server })
    wss.on('connection', ws => ws.on('message', data => ws.send(`${owner.slice(0, 4)}:${String(data)}`)))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const lifetime = new AbortController()
    const entry = { owner, server, stopped: false, broker: session.broker }
    started.push(entry)
    return {
      value: { port: (server.address() as { port: number }).port, internalCookie: `dsh-auth-internal=${owner.slice(0, 8)}`, pid: 1 },
      signal: lifetime.signal,
      stop: async () => { entry.stopped = true; lifetime.abort(); wss.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
    }
  })
  return { started, startHost }
}

async function setup(options: { idleMs?: number; compact?: boolean; receipts?: MemoryReceiptStore } = {}) {
  const port = await freePort()
  const publicOrigin = `http://localhost:${port}`
  const api = oryh(), host = hosts()
  const control = await startControlServer({
    publicOrigin, ownerDomain: `localhost:${port}`, servers: [{ id: 'oryh', label: 'ORYH', issuer }],
    startHost: host.startHost, loopbackDevelopment: true, fetch: api.fetch, idleMs: options.idleMs ?? 0, compactAuthorization: options.compact ?? false, ...options.receipts ? { receipts: options.receipts } : {},
  }, port)
  cleanup.push(() => control.close())

  function call(hostname: string, path: string, headers: Record<string, string> = {}, method = 'GET') {
    return new Promise<{ status: number; body: string; cookies: string[]; location?: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `${hostname}:${port}`, ...headers } }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), cookies: res.headers['set-cookie'] ?? [], ...res.headers.location ? { location: res.headers.location } : {} }))
      })
      req.on('error', reject)
      req.end()
    })
  }
  const pick = (cookies: string[], name: string) => cookies.find(c => c.startsWith(`${name}=`))!.split(';')[0]!

  /** One browser signing in as `user`, all the way into its owner domain. */
  async function signIn(user: string) {
    expect((await call('localhost', '/')).location).toBe('/oryh/auth/login')
    const begin = await call('localhost', '/oryh/auth/login')
    const authorize = new URL(begin.location!)
    const state = authorize.searchParams.get('state')!
    const loginCookie = pick(begin.cookies, '__Host-oryh-login')
    const callbackPath = new URL(authorize.searchParams.get('redirect_uri')!).pathname
    const callback = await call('localhost', `${callbackPath}?state=${state}&code=${user}`, { cookie: loginCookie })
    expect(callback.location).toBe('/')
    const session = pick(callback.cookies, '__Host-oryh-session')
    // A browser following the callback's redirect still carries the cross-site marker of ORYH's page.
    const bounced = await call('localhost', '/', { cookie: session, 'sec-fetch-site': 'cross-site' })
    expect(bounced.status).toBe(200)
    expect(bounced.body).toContain('url=/')
    const entry = await call('localhost', '/', { cookie: session, 'sec-fetch-site': 'same-origin' })
    const enter = new URL(entry.location!)
    const label = enter.hostname.split('.')[0]!
    const entered = await call(`${label}.localhost`, `${enter.pathname}${enter.search}`)
    expect(entered.location).toBe('/')
    return { session, label, owner: pick(entered.cookies, 'oryh-owner'), ticketPath: `${enter.pathname}${enter.search}`, authorize }
  }
  return { port, call, signIn, api, host, publicOrigin }
}

describe('the control server', () => {
  it('signs a person in and serves their Host from their own owner domain, without leaking either cookie', async () => {
    const f = await setup()
    const a = await f.signIn('alice')
    const page = await f.call(`${a.label}.localhost`, '/sessions?x=1', { cookie: a.owner })
    expect(page.status, page.body).toBe(200)
    const seen = JSON.parse(page.body)
    expect(seen.owner.startsWith(a.label)).toBe(true)
    expect(seen.cookie).toBe(`dsh-auth-internal=${a.label.slice(0, 8)}`)
    expect(seen.host).toMatch(/^127\.0\.0\.1:\d+$/)
    expect(seen.path).toBe('/sessions?x=1')
    expect(page.cookies).toEqual([])
    // The Host's ORYH access goes through the broker, under this person's grant.
    expect(JSON.parse((await f.call(`${a.label}.localhost`, '/broker', { cookie: a.owner })).body)).toEqual({ data: [{ user: 'alice' }] })
  })

  it('keeps a compact authorization request within the 128 characters older ORYH releases store', async () => {
    const f = await setup({ compact: true })
    const { authorize, label } = await f.signIn('alice')
    const p = authorize.searchParams
    expect(p.has('resource')).toBe(false)
    // ORYH before calwbiz ecab43d stores these joined with "|" in a varchar(128); a localhost:4300 origin must fit.
    const fingerprint = [p.get('response_type'), p.get('client_id'), p.get('redirect_uri'), p.get('code_challenge'), p.get('code_challenge_method'), p.get('state'), p.get('scope') ?? '', p.get('resource') ?? ''].join('|')
    const at4300 = fingerprint.replaceAll(`localhost:${f.port}`, 'localhost:4300')
    expect(at4300.length).toBeLessThanOrEqual(128)
    expect((await f.call(`${label}.localhost`, '/')).status).toBe(303)
  })

  it('records each owner\'s writes under that owner when receipts are configured, and stays read-only without', async () => {
    const receipts = new MemoryReceiptStore()
    const f = await setup({ receipts })
    const a = await f.signIn('alice')
    await f.call(`${a.label}.localhost`, '/broker-write', { cookie: a.owner })
    const [receipt] = receipts.list(f.host.started[0]!.owner)
    expect(receipt).toMatchObject({ operationId: 'op-control-1', operation: 'project.create', kind: 'chat' })
    const readOnly = await setup()
    const b = await readOnly.signIn('bob')
    expect(JSON.parse((await readOnly.call(`${b.label}.localhost`, '/broker-write', { cookie: b.owner })).body).body).toContain('只读')
  })

  it('spends tickets once and keeps owners apart', async () => {
    const f = await setup()
    const a = await f.signIn('alice'), b = await f.signIn('bob')
    expect(a.label).not.toBe(b.label)
    expect((await f.call(`${a.label}.localhost`, a.ticketPath)).cookies).toEqual([])
    expect((await f.call(`${b.label}.localhost`, '/', { cookie: a.owner })).status).toBe(303)
    expect((await f.call(`${b.label}.localhost`, '/api/x', { cookie: a.owner })).status).toBe(403)
    expect((await f.call(`${a.label}.localhost`, '/api/x', { cookie: a.owner, origin: `http://${b.label}.localhost:${f.port}` }, 'POST')).status).toBe(403)
    expect(JSON.parse((await f.call(`${b.label}.localhost`, '/', { cookie: b.owner })).body).owner.startsWith(b.label)).toBe(true)
    expect((await f.call('elsewhere.test', '/')).status).toBe(421)
  })

  it('tunnels WebSockets to the owner Host only for that owner domain', async () => {
    const f = await setup()
    const a = await f.signIn('alice')
    const connect = (origin: string, cookie: string) => new WebSocket(`ws://127.0.0.1:${f.port}/api/remote.mux`, { headers: { host: `${a.label}.localhost:${f.port}`, cookie, origin } })
    const ws = connect(`http://${a.label}.localhost:${f.port}`, a.owner)
    cleanup.push(() => ws.terminate())
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const echoed = new Promise<string>(resolve => ws.once('message', data => resolve(String(data))))
    ws.send('ping')
    expect(await echoed).toBe(`${a.label.slice(0, 4)}:ping`)
    const refused = connect('http://attacker.invalid', a.owner)
    await new Promise<void>(resolve => { refused.once('unexpected-response', (_req, res) => { expect(res.statusCode).toBe(403); res.resume(); refused.terminate(); resolve() }); refused.once('error', () => {}) })
  })

  it('ends one browser without affecting another of the same person, and stops the Host after the last', async () => {
    const f = await setup()
    const first = await f.signIn('alice'), second = await f.signIn('alice')
    expect(first.label).toBe(second.label)
    expect(f.host.startHost).toHaveBeenCalledTimes(1)
    const logout = await f.call('localhost', '/oryh/auth/logout', { cookie: first.session, origin: f.publicOrigin }, 'POST')
    expect(logout.status).toBe(204)
    expect((await f.call(`${first.label}.localhost`, '/', { cookie: first.owner })).status).toBe(303)
    expect((await f.call(`${second.label}.localhost`, '/', { cookie: second.owner })).status).toBe(200)
    expect(JSON.parse((await f.call(`${second.label}.localhost`, '/broker', { cookie: second.owner })).body)).toEqual({ data: [{ user: 'alice' }] })
    expect(f.api.revoked).toEqual(['refresh-alice'])
    await f.call('localhost', '/oryh/auth/logout', { cookie: second.session, origin: f.publicOrigin }, 'POST')
    await vi.waitFor(() => expect(f.host.started[0]!.stopped).toBe(true))
    expect((await f.call(`${second.label}.localhost`, '/', { cookie: second.owner })).status).toBe(303)
  })
})
