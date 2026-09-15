/**
 * The ORYH server's control process (docs/33 §3): sign-in, each person's grants, their Host, and the
 * owner-domain proxy that puts a browser in front of that Host.
 *
 * Two kinds of address are served. The public origin signs people in with ORYH. Each owner is served
 * from their own subdomain, `<label>.<ownerDomain>`, so one person's workbench never shares a browser
 * origin with another's. A signed-in browser crosses from the public origin to its owner domain with a
 * one-time ticket; the owner domain turns that into its own cookie, bound to the sign-in and the Host
 * lease, and forwards every request — WebSockets included — to the Host with the Host's internal
 * session cookie in place of the browser's.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, request as upstreamRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { OryhIdentity } from '@oryh/ai-client-core'
import { mountLoginRoutes, type RuntimeLease } from './login-routes.js'
import { ServerOAuth, type LoginGrant } from './oauth.js'
import { OwnerBroker } from './owner-broker.js'
import type { OwnerHostTarget } from './owner-host.js'
import { RuntimePool, type RunningRuntime } from './runtime-pool.js'

export interface ControlServerOptions {
  /** Where people sign in, e.g. `https://oryh-client.example.com` or `http://localhost:4300`. */
  readonly publicOrigin: string
  /** Owners are served from `<label>.<ownerDomain>` on the public origin's scheme, e.g. `localhost:4300`. */
  readonly ownerDomain: string
  /** ORYH deployments people may sign in to. */
  readonly servers: readonly { readonly id: string; readonly label: string; readonly issuer: string }[]
  /** Start one owner's Host; `ownerHostFactory` in production, a stand-in in tests. */
  readonly startHost: (owner: string, generation: number, signal: AbortSignal, session: { identity: OryhIdentity; broker: OwnerBroker }) => Promise<RunningRuntime<OwnerHostTarget>>
  readonly capacity?: number
  readonly idleMs?: number
  readonly sessionTtlMs?: number
  /** Serve `http://localhost` addresses; local development only. */
  readonly loopbackDevelopment?: boolean
  /** Listen address; defaults to loopback in development and all interfaces otherwise. */
  readonly listenHost?: string
  readonly fetch?: typeof fetch
  readonly log?: (line: string) => void
}

interface OwnerSession { owner: string; label: string; signal: AbortSignal; lease: RuntimeLease }
interface Ticket extends OwnerSession { expires: number }

const OWNER_COOKIE = 'oryh-owner'
const TICKET_TTL_MS = 60_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
/** Hop-by-hop and identity headers never forwarded to a Host. */
const DROPPED = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'cookie', 'authorization', 'host', 'origin', 'forwarded', 'referer'])

/**
 * Start the control process's HTTP server.
 * @param options - trusted deployment configuration.
 * @param port - listen port; 0 picks one.
 * @returns the bound port and a `close` that ends sessions and stops every Host.
 */
export async function startControlServer(options: ControlServerOptions, port = 0): Promise<{ port: number; close(): Promise<void> }> {
  const publicUrl = new URL(options.publicOrigin)
  if (publicUrl.origin !== options.publicOrigin) throw new Error('publicOrigin must be an origin')
  const scheme = publicUrl.protocol
  const ownerOrigin = (label: string) => `${scheme}//${label}.${options.ownerDomain}`
  const log = options.log ?? (() => {})

  // Grants live only in this process. A restart ends every sign-in (docs/33 §4).
  const records = new Map<CredentialKey, CredentialRecord>()
  const credentials = {
    readRecord: async (key: CredentialKey) => records.get(key),
    modifyRecord: async (key: CredentialKey, change: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const next = await change(records.get(key))
      if (next) records.set(key, next); else records.delete(key)
      return next
    },
    deleteRecord: async (key: CredentialKey) => { records.delete(key) },
  }
  const servers = options.servers.map(server => ({
    id: server.id,
    label: server.label,
    oauth: new ServerOAuth({
      issuer: server.issuer,
      clientId: `${options.publicOrigin}/oryh/client.json`,
      callback: `${options.publicOrigin}/oryh/auth/callback`,
      credentials,
      ...options.fetch ? { fetch: options.fetch } : {},
      ...options.loopbackDevelopment ? { allowLoopbackForTest: true } : {},
    }),
  }))

  // Every live browser grant, per owner, newest first. The broker sends under the first still active.
  const grants = new Map<string, { grant: LoginGrant; oauth: ServerOAuth }[]>()
  const brokers = new Map<string, OwnerBroker>()
  function brokerFor(owner: string, oauth: ServerOAuth): OwnerBroker {
    let broker = brokers.get(owner)
    if (!broker) {
      broker = new OwnerBroker({
        issuer: oauth.serverOrigin,
        grants: () => (grants.get(owner) ?? []).map(entry => ({ signal: entry.oauth.signal(entry.grant), accessToken: () => entry.oauth.accessToken(entry.grant) })),
        ...options.fetch ? { fetch: options.fetch } : {},
      })
      brokers.set(owner, broker)
    }
    return broker
  }
  function remember(grant: LoginGrant, oauth: ServerOAuth) {
    const list = grants.get(grant.owner) ?? []
    grants.set(grant.owner, [{ grant, oauth }, ...list])
    oauth.signal(grant).addEventListener('abort', () => {
      const remaining = (grants.get(grant.owner) ?? []).filter(entry => entry.grant !== grant)
      if (remaining.length) grants.set(grant.owner, remaining)
      else { grants.delete(grant.owner); brokers.delete(grant.owner) }
    }, { once: true })
  }

  const pool = new RuntimePool<OwnerHostTarget>({
    capacity: options.capacity ?? 4,
    idleMs: options.idleMs ?? 5 * 60_000,
    start: async (owner, generation, signal) => {
      const latest = grants.get(owner)?.[0]
      if (!latest) throw new Error('No live grant for this owner')
      log(`starting Host for owner ${owner.slice(0, 8)} (generation ${generation})`)
      return options.startHost(owner, generation, signal, { identity: latest.grant.identity, broker: brokerFor(owner, latest.oauth) })
    },
  })

  // mountLoginRoutes needs only route registration and disposal from its Harness context.
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => unknown>()
  const disposers: (() => unknown)[] = []
  const loginContext = {
    webServer: { register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    effect: (setup: () => unknown) => { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose as () => unknown) },
  } as unknown as Context
  const login = mountLoginRoutes(loginContext, servers, {
    publicOrigin: options.publicOrigin,
    ...options.sessionTtlMs ? { sessionTtlMs: options.sessionTtlMs } : {},
    ...options.loopbackDevelopment ? { allowLoopback: true } : {},
    acquire: async (grant, signal, oauth) => {
      remember(grant, oauth)
      return pool.acquire(grant.owner, signal)
    },
  })

  const tickets = new Map<string, Ticket>()
  const ownerSessions = new Map<string, OwnerSession>()
  const sockets = new Set<Duplex>()

  function ownerLabelOf(host: string | undefined): string | undefined {
    if (!host) return undefined
    const suffix = `.${options.ownerDomain}`
    if (!host.endsWith(suffix)) return undefined
    const label = host.slice(0, -suffix.length)
    return /^[a-f0-9]{32}$/.test(label) ? label : undefined
  }

  function cookie(req: IncomingMessage, name: string): string | undefined {
    const values = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
    return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined
  }

  function live(session: OwnerSession): OwnerHostTarget | undefined {
    if (session.signal.aborted || session.lease.signal.aborted) return undefined
    try { return pool.resolve(session.lease) } catch { return undefined }
  }

  /** The signed-in browser's owner session on this owner domain, or nothing. */
  function ownerSession(req: IncomingMessage, label: string): { session: OwnerSession; target: OwnerHostTarget } | undefined {
    const value = cookie(req, OWNER_COOKIE)
    if (!value) return undefined
    const key = hash(value)
    const session = ownerSessions.get(key)
    if (!session || session.label !== label) return undefined
    const target = live(session)
    if (!target) { ownerSessions.delete(key); return undefined }
    return { session, target }
  }

  function sweep() {
    const now = Date.now()
    for (const [key, ticket] of tickets) if (ticket.expires <= now) tickets.delete(key)
    for (const [key, session] of ownerSessions) if (!live(session)) ownerSessions.delete(key)
  }
  const timer = setInterval(sweep, 10_000)
  timer.unref()

  async function publicRequest(req: IncomingMessage, res: ServerResponse, url: URL) {
    const handler = routes.get(url.pathname)
    if (handler) { await handler(req, res); return }
    if (url.pathname !== '/' || req.method !== 'GET') { res.writeHead(404); res.end(); return }
    let authorized: ReturnType<typeof login.authorize>
    try { authorized = login.authorize(req) } catch {
      if (servers.length === 1) { res.writeHead(303, { location: '/oryh/auth/login', 'cache-control': 'no-store' }); res.end(); return }
      page(res, 200, '登录 ORYH AI Client', servers.map(s => `<p><a class="button" href="/oryh/auth/login?server=${encodeURIComponent(s.id)}">登录 ${escape(s.label)}</a></p>`).join(''))
      return
    }
    const owner = authorized.runtime.owner
    const label = owner.slice(0, 32)
    const value = token()
    tickets.set(hash(value), { owner, label, signal: authorized.signal, lease: authorized.runtime, expires: Date.now() + TICKET_TTL_MS })
    res.writeHead(303, { location: `${ownerOrigin(label)}/oryh/enter?ticket=${value}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
    res.end()
  }

  function ownerRequest(req: IncomingMessage, res: ServerResponse, url: URL, label: string) {
    if (url.pathname === '/oryh/enter') {
      const value = url.searchParams.get('ticket') ?? ''
      const key = hash(value)
      const ticket = tickets.get(key)
      tickets.delete(key)
      if (req.method !== 'GET' || !ticket || ticket.label !== label || ticket.expires <= Date.now() || !live(ticket)) {
        res.writeHead(303, { location: `${options.publicOrigin}/`, 'cache-control': 'no-store' }); res.end(); return
      }
      const session = token()
      ownerSessions.set(hash(session), { owner: ticket.owner, label, signal: ticket.signal, lease: ticket.lease })
      res.writeHead(303, {
        location: '/',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'set-cookie': `${OWNER_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      })
      res.end()
      return
    }
    const found = ownerSession(req, label)
    if (!found) {
      // A navigation goes back through sign-in; anything else is refused outright.
      if (req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || url.pathname === '/')) {
        res.writeHead(303, { location: `${options.publicOrigin}/`, 'cache-control': 'no-store' }); res.end(); return
      }
      res.writeHead(403); res.end('Sign in again.'); return
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '') && req.headers.origin !== ownerOrigin(label)) { res.writeHead(403); res.end(); return }
    const { target, session } = found
    const outgoing = upstreamRequest({ host: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req, target, label) }, incoming => {
      const headers = { ...incoming.headers }
      delete headers['set-cookie']
      for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) delete headers[name]
      if (headers.location && (!headers.location.startsWith('/') || headers.location.startsWith('//') || headers.location.includes('token='))) {
        incoming.destroy(); res.writeHead(502); res.end(); return
      }
      res.writeHead(incoming.statusCode ?? 502, headers)
      incoming.pipe(res)
    })
    const end = () => outgoing.destroy()
    session.signal.addEventListener('abort', end, { once: true })
    res.once('close', () => { session.signal.removeEventListener('abort', end); outgoing.destroy() })
    outgoing.once('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(outgoing)
  }

  function forwardHeaders(req: IncomingMessage, target: OwnerHostTarget, label: string) {
    const nominated = new Set(String(req.headers.connection ?? '').toLowerCase().split(',').map(s => s.trim()))
    const headers: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !DROPPED.has(name) && !nominated.has(name) && !name.startsWith('x-forwarded')) headers[name] = value
    }
    headers.host = `127.0.0.1:${target.port}`
    headers.cookie = target.internalCookie
    if (req.headers.origin === ownerOrigin(label)) headers.origin = `http://127.0.0.1:${target.port}`
    return headers
  }

  const server: Server = createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff')
    let url: URL
    try { url = new URL(req.url ?? '/', 'http://control.invalid') } catch { res.writeHead(400); res.end(); return }
    const host = req.headers.host
    const label = ownerLabelOf(host)
    if (host !== publicUrl.host && !label) { res.writeHead(421); res.end(); return }
    Promise.resolve().then(() => host === publicUrl.host ? publicRequest(req, res, url) : ownerRequest(req, res, url, label!)).catch(error => {
      log(`request failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
  })

  server.on('upgrade', (req, socket, head) => {
    const label = ownerLabelOf(req.headers.host)
    const found = label ? ownerSession(req, label) : undefined
    if (!label || !found || req.headers.origin !== ownerOrigin(label)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const { target, session } = found
    sockets.add(socket)
    const out = upstreamRequest({ host: '127.0.0.1', port: target.port, path: req.url, headers: { ...forwardHeaders(req, target, label), connection: 'Upgrade', upgrade: 'websocket' } })
    out.once('upgrade', (response, upstream, upstreamHead) => {
      const lines = Object.entries(response.headers).filter(([name]) => name !== 'set-cookie').map(([name, value]) => `${name}: ${String(value)}`)
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.length) socket.write(upstreamHead)
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
      const end = () => { upstream.destroy(); socket.destroy() }
      session.signal.addEventListener('abort', end, { once: true })
      session.lease.signal.addEventListener('abort', end, { once: true })
      socket.once('close', () => { upstream.destroy(); session.signal.removeEventListener('abort', end); session.lease.signal.removeEventListener('abort', end) })
      upstream.once('close', () => socket.destroy())
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
    })
    out.once('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') })
    out.once('error', () => socket.destroy())
    socket.once('close', () => { sockets.delete(socket); out.destroy() })
    out.end()
  })

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, options.listenHost ?? (options.loopbackDevelopment ? '127.0.0.1' : '0.0.0.0'), resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Control server did not bind')
  return {
    port: address.port,
    async close() {
      clearInterval(timer)
      for (const socket of sockets) socket.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      for (const dispose of disposers.reverse()) await dispose()
      await pool.close()
    },
  }
}


function escape(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

function page(res: ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f5f5;color:#222}main{background:#fff;padding:32px 40px;border-radius:8px;box-shadow:0 1px 4px #0002;max-width:420px}.button{display:inline-block;background:#0f6cbd;color:#fff;padding:8px 20px;border-radius:4px;text-decoration:none}</style>
<main><h1 style="font-size:20px">${escape(title)}</h1>${body}</main></html>`)
}
