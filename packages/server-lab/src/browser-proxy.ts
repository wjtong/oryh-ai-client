import { createServer, request as upstreamRequest, type IncomingMessage, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'

export interface NativeRoute {
  readonly owner: string
  readonly hostname: string
  readonly port: number
  /** Exchanged by the trusted Host, never issued to the browser. */
  readonly internalCookie: string
}
interface Lease { owner: string; expiresAt: number; sockets: Set<Duplex> }
const COOKIE = 'oryh-p0-session'
const drop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'cookie', 'authorization', 'host', 'origin', 'forwarded'])

/**
 * Loopback-only S0-1 transport experiment. Leases are issued by trusted test code, NOT a login
 * API. Runtime subdomains preserve native root paths. No decoding of Harness mux messages.
 */
export class BrowserProxy {
  readonly #routes = new Map<string, Readonly<NativeRoute>>()
  readonly #leases = new Map<string, Lease>()
  readonly #server: Server
  #port = 0
  constructor(routes: readonly NativeRoute[]) {
    for (const r of routes) {
      if (!/^[a-z0-9-]+\.localhost$/.test(r.hostname) || !Number.isInteger(r.port) || r.port <= 0 || r.port > 65535 || this.#routes.has(r.hostname)) throw new Error('Invalid private route')
      this.#routes.set(r.hostname, Object.freeze({ ...r }))
    }
    this.#server = createServer((req, res) => {
      const auth = this.authorize(req, false)
      if (!auth) { res.writeHead(403); res.end('Forbidden'); return }
      const outgoing = upstreamRequest({ hostname: '127.0.0.1', port: auth.route.port, method: req.method, path: req.url, headers: this.headers(req, auth.route, false) }, incoming => {
        if (!this.live(auth.lease)) { incoming.destroy(); res.destroy(); return }
        const headers = { ...incoming.headers }
        delete headers['set-cookie']
        for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) delete headers[name]
        if (headers.location) {
          // Only clean relative locations are accepted in this experiment. A redirect can neither
          // disclose an internal authority/token nor make the browser leave its owner route.
          if (!headers.location.startsWith('/') || headers.location.startsWith('//') || new URL(headers.location, 'http://local').searchParams.has('token')) {
            incoming.destroy(); res.writeHead(502); res.end('Invalid upstream redirect'); return
          }
        }
        headers['cache-control'] = 'no-store'
        res.writeHead(incoming.statusCode ?? 502, headers)
        incoming.pipe(res)
      })
      const socket = req.socket
      auth.lease.sockets.add(socket)
      const timer = this.expire(auth.lease)
      const release = () => { auth.lease.sockets.delete(socket); clearTimeout(timer) }
      res.once('close', () => { outgoing.destroy(); release() })
      outgoing.once('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Upstream unavailable') })
      req.pipe(outgoing)
    })
    this.#server.on('upgrade', (req, socket, head) => {
      const auth = this.authorize(req, true)
      if (!auth) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
      auth.lease.sockets.add(socket)
      const timer = this.expire(auth.lease)
      const out = upstreamRequest({ hostname: '127.0.0.1', port: auth.route.port, path: req.url, headers: this.headers(req, auth.route, true) })
      out.once('upgrade', (response, upstream, upstreamHead) => {
        if (!this.live(auth.lease)) { upstream.destroy(); socket.destroy(); return }
        const headers = Object.entries(response.headers).filter(([k]) => !['set-cookie', 'location'].includes(k))
          .map(([k, v]) => `${k}: ${String(v)}`).join('\r\n')
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`)
        if (upstreamHead.length) socket.write(upstreamHead)
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
        socket.once('close', () => upstream.destroy()); upstream.once('close', () => socket.destroy())
        socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
      })
      out.once('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') })
      out.once('error', () => socket.destroy())
      socket.once('close', () => { clearTimeout(timer); auth.lease.sockets.delete(socket); out.destroy() })
      out.end()
    })
  }
  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => { this.#server.once('error', reject); this.#server.listen(0, '127.0.0.1', resolve) })
    const address = this.#server.address()
    if (!address || typeof address === 'string') throw new Error('Proxy did not bind')
    this.#port = address.port
    return this.#port
  }
  issue(owner: string, ttlMs = 60_000): string {
    if (![...this.#routes.values()].some(r => r.owner === owner) || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 300_000) throw new Error('Invalid lease')
    const token = randomBytes(32).toString('base64url')
    this.#leases.set(token, { owner, expiresAt: Date.now() + ttlMs, sockets: new Set() })
    return `${COOKIE}=${token}`
  }
  revoke(cookie: string): void {
    const token = cookie.slice(`${COOKIE}=`.length)
    const lease = this.#leases.get(token)
    if (lease) { lease.expiresAt = 0; for (const socket of lease.sockets) socket.destroy(); this.#leases.delete(token) }
  }
  private live(lease: Lease) { return lease.expiresAt > Date.now() }
  private expire(lease: Lease) { return setTimeout(() => { for (const s of lease.sockets) s.destroy() }, Math.max(0, lease.expiresAt - Date.now())) }
  private authorize(req: IncomingMessage, upgrade: boolean) {
    const host = req.headers.host
    if (!host || !req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return
    let url: URL
    try { url = new URL(`http://${host}${req.url}`) } catch { return }
    if (url.host !== host || url.port !== String(this.#port) || url.searchParams.has('token')) return
    const route = this.#routes.get(url.hostname)
    if (!route || req.headers.authorization || Object.keys(req.headers).some(k => k.startsWith('x-') || k === 'forwarded')) return
    if ((upgrade || !['GET', 'HEAD'].includes(req.method ?? '')) && req.headers.origin !== `http://${host}`) return
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return
    const tokens = (req.headers.cookie ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${COOKIE}=`))
    if (tokens.length !== 1) return
    const lease = this.#leases.get(tokens[0]!.slice(`${COOKIE}=`.length))
    if (!lease || !this.live(lease) || lease.owner !== route.owner) return
    return { route, lease }
  }
  private headers(req: IncomingMessage, route: NativeRoute, upgrade: boolean) {
    const nominated = new Set((req.headers.connection ?? '').toLowerCase().split(',').map(s => s.trim()))
    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !drop.has(k) && !nominated.has(k) && !k.startsWith('x-')) headers[k] = v
    headers.host = `127.0.0.1:${route.port}`
    headers.cookie = route.internalCookie
    if (req.headers.origin) headers.origin = `http://127.0.0.1:${route.port}`
    if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket' }
    return headers
  }
  async close(): Promise<void> {
    for (const lease of this.#leases.values()) for (const socket of lease.sockets) socket.destroy()
    this.#leases.clear()
    this.#server.closeAllConnections()
    await new Promise<void>((resolve, reject) => this.#server.close(e => e ? reject(e) : resolve()))
  }
}
