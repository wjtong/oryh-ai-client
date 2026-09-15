/** P0 browser authentication adapter on the public Harness WebServer. No application shell. */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ServerOAuth, type LoginGrant } from './oauth.js'

const LOGIN = '__Host-oryh-login', SESSION = '__Host-oryh-session'
const random = () => randomBytes(32).toString('base64url')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const failed = () => new Error('Login or session unavailable')
export interface RuntimeLease {
  readonly owner: string
  readonly generation: number
  readonly signal: AbortSignal
  release(): Promise<void>
}
export interface LoginServer { readonly id: string; readonly label: string; readonly oauth: ServerOAuth }
interface BrowserSession { server: LoginServer; grant: LoginGrant; runtime: RuntimeLease; abort: AbortController; expires: number; active: boolean; stop: () => void }
interface Flow { server: LoginServer; claimed?: boolean; binding: string; abort: AbortController; expires: number }

/** All parameters are trusted plugin configuration; HTTP input cannot select a runtime or issuer. */
export function mountLoginRoutes(ctx: Context, configured: ServerOAuth | readonly LoginServer[], options: {
  publicOrigin: string
  acquire: (grant: LoginGrant, signal: AbortSignal, oauth: ServerOAuth) => Promise<RuntimeLease>
  now?: () => number
  sessionTtlMs?: number
  /** Accept an `http://localhost` public origin, for local development only; browsers treat it as secure. */
  allowLoopback?: boolean
}) {
  const servers = (configured instanceof ServerOAuth ? [{ id: 'default', label: configured.serverOrigin, oauth: configured }] : configured).map(server => Object.freeze({ ...server }))
  if (!servers.length || servers.some(server => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(server.id) || !server.label.trim()) || new Set(servers.map(s => s.id)).size !== servers.length || new Set(servers.map(s => s.oauth.serverOrigin)).size !== servers.length) throw new Error('Invalid ORYH server configuration')
  const oauth = servers[0]!.oauth
  const origin = new URL(options.publicOrigin)
  const metadata = oauth.browserMetadata()
  if (!(origin.protocol === 'https:' || (options.allowLoopback && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) || origin.origin !== options.publicOrigin || origin.username || origin.password ||
    metadata.callback !== `${origin.origin}/oryh/auth/callback` || new URL(metadata.clientId).origin !== origin.origin) throw new Error('Invalid login route configuration')
  if (servers.some(server => JSON.stringify(server.oauth.browserMetadata()) !== JSON.stringify(metadata))) throw new Error('ORYH servers must share the client callback')
  const ttl = options.sessionTtlMs ?? 8 * 3600_000
  if (!Number.isFinite(ttl) || ttl < 1000 || ttl > 12 * 3600_000) throw new Error('Invalid session lifetime')
  const now = options.now ?? Date.now
  const sessions = new Map<string, BrowserSession>(), flows = new Map<string, Flow>()
  const inFlight = new Set<Promise<unknown>>()
  let closed = false
  const cookie = (name: string, value: string, age: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`
  function readCookie(req: IncomingMessage, name: string): string | undefined {
    const entries = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`))
    if (entries.length > 1) throw failed()
    const value = entries[0]?.slice(name.length + 1)
    if (value !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(value)) throw failed()
    return value
  }
  function requestUrl(req: IncomingMessage): URL {
    if (closed || req.headers.host !== origin.host || !req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\') ||
      req.headers.authorization || req.headers.forwarded || Object.keys(req.headers).some(k => k.startsWith('x-forwarded-'))) throw failed()
    const url = new URL(req.url, origin)
    if (url.origin !== origin.origin) throw failed()
    return url
  }
  function sameOrigin(req: IncomingMessage, mutation: boolean) {
    if ((mutation || req.headers.origin) && req.headers.origin !== origin.origin) throw failed()
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw failed()
  }
  function cancelFlow(token: string | undefined) {
    if (!token) return
    const key = hash(token), flow = flows.get(key)
    flow?.abort.abort(); flows.delete(key)
  }
  async function end(key: string, session: BrowserSession) {
    if (!session.active) return
    session.active = false; session.abort.abort(); session.stop(); sessions.delete(key)
    const results = await Promise.allSettled([session.server.oauth.revoke(session.grant), session.runtime.release()])
    if (results.some(r => r.status === 'rejected')) throw failed()
  }
  function background(promise: Promise<unknown>) {
    inFlight.add(promise)
    void promise.catch(() => {}).finally(() => inFlight.delete(promise))
  }
  function sweep() {
    for (const [key, flow] of flows) if (flow.expires <= now()) { flow.abort.abort(); flows.delete(key) }
    for (const [key, session] of sessions) if (session.expires <= now()) background(end(key, session))
  }
  /** Called by trusted business/runtime routing, never exported as a Remote method. */
  function authorize(req: IncomingMessage) {
    requestUrl(req); sameOrigin(req, Boolean(req.headers.upgrade) || !['GET', 'HEAD'].includes(req.method ?? ''))
    const token = readCookie(req, SESSION), key = token ? hash(token) : ''
    const session = sessions.get(key)
    if (!session?.active) throw failed()
    if (session.expires <= now() || session.runtime.signal.aborted || session.server.oauth.signal(session.grant).aborted) {
      background(end(key, session)); throw failed()
    }
    return { server: session.server, oauth: session.server.oauth, grant: session.grant, runtime: session.runtime, signal: session.abort.signal }
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-content-type-options', 'nosniff')
    try {
      const url = requestUrl(req)
      if (url.pathname === new URL(metadata.clientId).pathname) {
        if (req.method !== 'GET' || url.search) throw failed()
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ client_id: metadata.clientId, client_name: 'ORYH AI Client', redirect_uris: [metadata.callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })); return
      }
      if (url.pathname === '/oryh/auth/servers') {
        if (req.method !== 'GET' || url.search) throw failed()
        sameOrigin(req, false)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(servers.map(s => ({ id: s.id, label: s.label, origin: s.oauth.serverOrigin })))); return
      }
      if (url.pathname === '/oryh/auth/login') {
        if (req.method !== 'GET' || [...url.searchParams.keys()].some(k => k !== 'server') || url.searchParams.getAll('server').length > 1) throw failed()
        const server = url.searchParams.has('server') ? servers.find(s => s.id === url.searchParams.get('server')) : servers[0]
        if (!server) throw failed()
        sameOrigin(req, false); sweep()
        cancelFlow(readCookie(req, LOGIN))
        if (flows.size >= 1000) throw failed()
        const flow: Flow = { server, binding: random(), abort: new AbortController(), expires: now() + 600_000 }
        flows.set(hash(flow.binding), flow)
        const started = server.oauth.begin(flow.binding, flow.abort.signal)
        res.setHeader('set-cookie', cookie(LOGIN, flow.binding, 600))
        res.writeHead(303, { location: started.authorizationUrl }); res.end(); return
      }
      if (url.pathname === '/oryh/auth/callback') {
        if (req.method !== 'GET' || url.search.length > 8192) throw failed()
        const p = url.searchParams
        for (const name of p.keys()) if (!['state', 'code', 'error', 'error_description', 'iss'].includes(name) || p.getAll(name).length !== 1) throw failed()
        if (!p.get('state') || Boolean(p.get('code')) === Boolean(p.get('error'))) throw failed()
        const binding = readCookie(req, LOGIN), flow = binding ? flows.get(hash(binding)) : undefined
        if (!flow || flow.claimed || flow.expires <= now()) throw failed()
        if (p.has('iss') && p.get('iss') !== flow.server.oauth.serverOrigin) throw failed()
        const oauth = flow.server.oauth
        const previous = readCookie(req, SESSION)
        flow.claimed = true
        let grant: LoginGrant | undefined, runtime: RuntimeLease | undefined
        let installed = false
        const disconnected = () => { if (!res.writableFinished) flow.abort.abort() }
        res.once('close', disconnected)
        try {
          grant = await oauth.complete({ state: p.get('state')!, binding: flow.binding, ...(p.get('code') ? { code: p.get('code')! } : { error: p.get('error')! }) })
          runtime = await options.acquire(grant, flow.abort.signal, oauth)
          if (closed || flow.abort.signal.aborted || runtime.signal.aborted || runtime.owner !== grant.owner || !Number.isSafeInteger(runtime.generation) || runtime.generation < 1 || sessions.size >= 1000) throw failed()
          const old = previous ? sessions.get(hash(previous)) : undefined
          if (old) await end(hash(previous!), old)
          if (closed || flow.abort.signal.aborted || res.destroyed) throw failed()
          const token = random(), key = hash(token)
          const session: BrowserSession = { server: flow.server, grant, runtime, abort: flow.abort, expires: now() + ttl, active: true, stop: () => {} }
          const revoked = () => background(end(key, session))
          const grantSignal = oauth.signal(grant)
          runtime.signal.addEventListener('abort', revoked, { once: true }); grantSignal.addEventListener('abort', revoked, { once: true })
          session.stop = () => { runtime!.signal.removeEventListener('abort', revoked); grantSignal.removeEventListener('abort', revoked) }
          sessions.set(key, session); installed = true
          res.setHeader('set-cookie', [cookie(LOGIN, '', 0), cookie(SESSION, token, Math.floor(ttl / 1000))])
          res.writeHead(303, { location: '/' }); res.end()
        } catch {
          await Promise.allSettled([...(grant ? [oauth.revoke(grant)] : []), ...(runtime ? [runtime.release()] : [])]); throw failed()
        } finally { res.removeListener('close', disconnected); if (installed) flows.delete(hash(binding!)); else cancelFlow(binding) }
        return
      }
      if (url.pathname === '/oryh/auth/session') {
        if (req.method !== 'GET' || url.search) throw failed()
        const { grant, runtime, server } = authorize(req)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ server: { id: server.id, label: server.label, origin: server.oauth.serverOrigin }, owner: grant.owner, identity: grant.identity, generation: runtime.generation })); return
      }
      if (url.pathname === '/oryh/auth/logout') {
        if (req.method !== 'POST' || url.search) throw failed()
        sameOrigin(req, true)
        const token = readCookie(req, SESSION), binding = readCookie(req, LOGIN)
        cancelFlow(binding)
        const session = token ? sessions.get(hash(token)) : undefined
        if (session) await end(hash(token!), session)
        res.setHeader('set-cookie', [cookie(LOGIN, '', 0), cookie(SESSION, '', 0)])
        res.writeHead(204); res.end(); return
      }
      throw failed()
    } catch { if (!res.headersSent) res.writeHead(403); res.end('Login or session unavailable') }
  }
  const paths = ['/oryh/auth/servers', '/oryh/auth/login', '/oryh/auth/callback', '/oryh/auth/session', '/oryh/auth/logout', new URL(metadata.clientId).pathname]
  if (new Set(paths).size !== paths.length || paths.some(p => p === '/')) throw new Error('Login route collision')
  const disposers: Array<() => void> = []
  try {
    for (const path of paths) disposers.push(ctx.webServer.register({ kind: 'exact', path, handler: (req, res) => {
      const pending = handle(req, res); inFlight.add(pending); return pending.finally(() => inFlight.delete(pending))
    } }))
  } catch (error) { for (const dispose of disposers) dispose(); throw error }
  const timer = setInterval(sweep, 1000); timer.unref()
  ctx.effect(() => async () => {
    closed = true; clearInterval(timer); for (const dispose of disposers) dispose()
    for (const flow of flows.values()) flow.abort.abort(); flows.clear()
    await Promise.allSettled([...sessions].map(([key, session]) => end(key, session)))
    await Promise.allSettled([...inFlight])
  })
  return { authorize }
}
