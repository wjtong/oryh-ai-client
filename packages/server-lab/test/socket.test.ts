import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type Server } from 'node:http'
import { LabBroker } from '../src/broker.js'
import { executionSocket } from '../src/socket.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
function send(path: string, body: unknown, options: { url?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ socketPath: path, path: options.url ?? '/execute', method: 'POST', headers: options.headers }, res => {
      let text = ''; res.on('data', chunk => { text += String(chunk) }); res.on('end', () => resolve({ status: res.statusCode!, body: text }))
    })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'op0-'))
  cleanup.push(() => rm(dir, { force: true, recursive: true }))
  const calls: string[] = []
  const broker = new LabBroker({ list: 'read', create: 'write' }, async r => { calls.push(r.owner.user) })
  const paths: string[] = []
  for (const user of ['1', '2']) {
    const owner = { deployment: 'test', tenant: 'A', user }
    broker.register(owner, `TEST-${user}`)
    const path = join(dir, user)
    const server: Server = await executionSocket(path, broker, broker.open(owner))
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())))
    paths.push(path)
  }
  return { paths, calls, broker }
}
const read = { id: 'r-1', action: 'list', kind: 'read', body: null }
it('binds each socket to a trusted owner and rejects alternate identity/targets', async () => {
  const { paths, calls } = await fixture()
  expect((await send(paths[0]!, read)).status).toBe(200)
  expect((await send(paths[1]!, read)).status).toBe(200)
  for (const extra of [{ owner: '2' }, { url: 'https://attacker.invalid' }, { approved: true }, { generation: 5 }]) {
    expect((await send(paths[0]!, { ...read, ...extra })).status).toBe(403)
  }
  expect((await send(paths[0]!, read, { headers: { 'X-Owner': '2' } })).status).toBe(403)
  expect(calls).toEqual(['1', '2'])
})
it('does not expose approval, credentials, management or unknown action endpoints', async () => {
  const { paths, calls } = await fixture()
  for (const url of ['/approve', '/credentials', '/advance', '/execute?tenant=B']) {
    expect((await send(paths[0]!, read, { url })).status).toBe(403)
  }
  expect((await send(paths[0]!, { ...read, action: 'create', kind: 'write' })).status).toBe(403)
  expect((await send(paths[0]!, { ...read, action: 'https://attacker.invalid' })).status).toBe(403)
  expect(calls).toHaveLength(0)
})
it('rejects oversized requests and revokes existing sockets', async () => {
  const { paths, broker } = await fixture()
  expect((await send(paths[0]!, { ...read, body: 'x'.repeat(17000) })).status).toBe(413)
  broker.revoke({ deployment: 'test', tenant: 'A', user: '1' })
  expect((await send(paths[0]!, read)).status).toBe(403)
  expect((await send(paths[1]!, read)).status).toBe(200)
})
