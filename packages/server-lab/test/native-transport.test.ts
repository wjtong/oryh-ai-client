import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Frontend from '@deepseek-ai/dsh-host-frontend-static'
import { createRequire } from 'node:module'
import { request } from 'node:http'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import ServerGateway, { type GatewayAdmission } from '../src/server-gateway.js'
import Registry from '@deepseek-ai/dsh-typert-registry'
import WebSocket from 'ws'
import { BrowserProxy } from '../src/browser-proxy.js'

/** No ambient environment, user home, or real credential provider is touched. */
class MemoryCredentials extends CredentialProvider {
  readonly records = new Map<CredentialKey, CredentialRecord>()
  async resolve() { return undefined }
  async describe() { return { configured: false, writable: false } }
  async set(): Promise<void> { throw new Error('Disabled in probe') }
  async unset(): Promise<void> { throw new Error('Disabled in probe') }
  async readRecord(key: CredentialKey) { return this.records.get(key) }
  async describeRecord(key: CredentialKey) { const r = this.records.get(key); return r ? { configured: true, writable: true, kind: r.kind } : { configured: false, writable: true } }
  async listRecords() { return [...this.records].map(([key, r]) => ({ key, kind: r.kind })) }
  async modifyRecord(key: CredentialKey, mutate: (r: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const r = await mutate(this.records.get(key)); if (r) this.records.set(key, r); return r
  }
  async deleteRecord(key: CredentialKey) { this.records.delete(key) }
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function native(owner: string, admission?: GatewayAdmission) {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Connection)
  await ctx.plugin(Registry)
  if (admission) { ctx.provide('oryhGatewayAdmission', admission); await ctx.plugin(ServerGateway) }
  else await ctx.plugin(Gateway)
  await ctx.plugin(Frontend, { distIndex: createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') })
  ctx.connection.fetch.register({ path: '/api/p0-owner', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async () => Response.json({ owner }) })
  ctx.connection.fetch.register({ path: '/api/p0-stream', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${owner}\n\n`)) },
  }), { headers: { 'Content-Type': 'text/event-stream' } }) })
  ctx.connection.fetch.register({ path: '/api/p0-download', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(`<svg><text>${owner}</text></svg>`, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="probe.svg"' } }) })
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const response = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  if (response.status !== 303) throw new Error('Private native auth exchange failed')
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Private native auth exchange missing cookie')
  return { ctx, origin, cookie }
}
async function setup() {
  const a = await native('A1'), b = await native('B1')
  const proxy = new BrowserProxy([
    { owner: 'A1', hostname: 'a1.localhost', port: a.ctx.webServer.port, internalCookie: a.cookie },
    { owner: 'B1', hostname: 'b1.localhost', port: b.ctx.webServer.port, internalCookie: b.cookie },
  ])
  const port = await proxy.listen()
  cleanup.push(() => proxy.close())
  return { a, b, proxy, port, ca: proxy.issue('A1'), cb: proxy.issue('B1') }
}
function get(port: number, host: string, cookie: string, path = '/', options: { method?: string; origin?: string; extra?: Record<string, string> } = {}) {
  return new Promise<{ status: number; text: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host: `${host}:${port}`, cookie, ...(options.origin ? { origin: options.origin } : {}), ...options.extra } }, res => {
      let text = ''; res.on('data', data => { text += String(data) }); res.on('end', () => resolve({ status: res.statusCode!, text, headers: res.headers }))
    }); req.on('error', reject); req.end()
  })
}
it('serves actual native frontend assets and Connection routes through owner subdomains', async () => {
  const { a, port, ca, cb } = await setup()
  expect((await fetch(a.origin)).status).toBe(401)
  const page = await get(port, 'a1.localhost', ca)
  expect(page.status).toBe(200)
  expect(page.text).toContain('__DSH_CONNECTION_RECOVERY__')
  expect(page.headers['set-cookie']).toBeUndefined()
  expect(page.text).not.toContain(a.cookie)
  expect(page.text).not.toContain(a.origin)
  const scripts = [...page.text.matchAll(/src="([^"\s]+\.js)"/g)].map(m => new URL(m[1]!, `http://a1.localhost:${port}/`).pathname)
  expect(scripts.length).toBeGreaterThan(0)
  for (const asset of scripts) expect((await get(port, 'a1.localhost', ca, asset)).status).toBe(200)
  expect((await get(port, 'a1.localhost', ca, '/api/p0-owner')).text).toBe('{"owner":"A1"}')
  expect((await get(port, 'b1.localhost', cb, '/api/p0-owner')).text).toBe('{"owner":"B1"}')
  expect((await get(port, 'a1.localhost', ca, '/index.html?session=p0')).status).toBe(200)
})
it('rejects wrong owners, spoofing, launch-token paths, and cross-origin writes before native routing', async () => {
  const { port, ca, cb } = await setup()
  for (const [host, cookie] of [['a1.localhost', cb], ['b1.localhost', ca], ['unknown.localhost', ca], ['a1.localhost', '']]) {
    expect((await get(port, host!, cookie!, '/api/p0-owner')).status).toBe(403)
  }
  expect((await get(port, 'a1.localhost', ca, '/?token=untrusted')).status).toBe(403)
  expect((await get(port, 'a1.localhost', ca, '/api/p0-owner', { extra: { 'X-Owner': 'B1' } })).status).toBe(403)
  expect((await get(port, 'a1.localhost', ca, '/api/p0-owner', { method: 'POST' })).status).toBe(403)
  expect((await get(port, 'a1.localhost', ca, '/api/p0-owner', { method: 'POST', origin: `http://b1.localhost:${port}` })).status).toBe(403)
  expect((await get(port, 'a1.localhost', ca, '/api/p0-owner', { method: 'POST', origin: `http://a1.localhost:${port}` })).status).toBe(200)
})
it('keeps authenticated downloads as attachments and refuses cross-owner links', async () => {
  const { port, ca, cb } = await setup()
  const result = await get(port, 'a1.localhost', ca, '/api/p0-download')
  expect(result.status).toBe(200)
  expect(result.headers['content-disposition']).toContain('attachment')
  expect((await get(port, 'a1.localhost', cb, '/api/p0-download')).status).toBe(403)
})
it('streams without buffering and closes the active stream when its browser lease is revoked', async () => {
  const { port, proxy, ca } = await setup()
  await new Promise<void>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/p0-stream', headers: { host: `a1.localhost:${port}`, cookie: ca } }, res => {
      res.once('data', data => { expect(String(data)).toContain('A1'); proxy.revoke(ca) })
      res.on('error', () => {})
      res.on('close', resolve)
    })
    req.on('error', reject); req.end()
  })
  expect((await get(port, 'a1.localhost', ca, '/api/p0-owner')).status).toBe(403)
})

it('tunnels the real Gateway mux websocket without parsing its protocol, supports reconnect and revocation', async () => {
  const { port, proxy, ca } = await setup()
  const connect = () => new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`, { headers: { host: `a1.localhost:${port}`, cookie: ca, origin: `http://a1.localhost:${port}` } })
  const opened = (ws: WebSocket) => new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const first = connect(); await opened(first)
  await new Promise<void>(resolve => { first.once('pong', () => resolve()); first.ping('transport-only') })
  const closed = new Promise<void>(resolve => first.once('close', () => resolve()))
  first.close(); await closed
  const second = connect(); await opened(second)
  const revoked = new Promise<void>(resolve => second.once('close', () => resolve()))
  proxy.revoke(ca); await revoked
  await new Promise<void>((resolve, reject) => {
    const denied = connect()
    denied.once('unexpected-response', (_req, res) => { expect(res.statusCode).toBe(403); res.resume(); denied.terminate(); resolve() })
    denied.once('error', () => {})
    denied.once('open', () => { denied.terminate(); reject(new Error('Revoked websocket accepted')) })
  })
})
it('expires leases and refuses cross-origin websocket upgrades', async () => {
  const { port, proxy, ca } = await setup()
  const expired = proxy.issue('A1', 1)
  await new Promise(r => setTimeout(r, 10))
  expect((await get(port, 'a1.localhost', expired)).status).toBe(403)
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`, { headers: { host: `a1.localhost:${port}`, cookie: ca, origin: 'http://attacker.invalid' } })
    ws.once('unexpected-response', (_req, res) => { expect(res.statusCode).toBe(403); res.resume(); ws.terminate(); resolve() })
    ws.once('error', () => {})
    ws.once('open', () => { ws.terminate(); reject(new Error('Cross-origin websocket accepted')) })
  })

})

it('runs external admission on native HTTP dispatch and mux stream opening', async () => {
  const admit = vi.fn(async () => { throw new Error('Owner admission rejected') })
  const { ctx, origin, cookie } = await native('A1', { admit })
  // A descriptor makes this namespace owned by the native Gateway. Admission
  // must run before resolving any receiver or calling the business operation.
  ctx.typert.register({ package: '@fixture/admission', face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: [{
      id: '@fixture/admission#session/prompt', service: 'sessionController', namespace: 'session', method: 'prompt',
      invocation: { kind: 'direct' }, parameters: [], result: { mode: 'src-json' },
    }] })
  const response = await fetch(`${origin}/api/session/prompt`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'admission-test', method: 'session/prompt', payload: { args: { request: { sessionId: 'foreign' } } } }) })
  expect(JSON.stringify(await response.json())).toContain('Owner admission rejected')
  expect(admit).toHaveBeenCalledTimes(1)
  expect(admit.mock.calls[0]?.[0]).toMatchObject({ namespace: 'session', method: 'prompt' })
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote.mux`, { headers: { cookie } })
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  try {
    const frame = new Promise<string>((resolve, reject) => { ws.once('message', data => resolve(String(data))); ws.once('error', reject) })
    ws.send(JSON.stringify({ type: 'open', streamId: 'denied-history', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'foreign' } } } } }))
    expect(await frame).toContain('Owner admission rejected')
    expect(admit).toHaveBeenCalledTimes(2)
    expect(admit.mock.calls[1]?.[0]).toMatchObject({ namespace: 'session', method: 'follow' })
  } finally { ws.terminate() }
})
