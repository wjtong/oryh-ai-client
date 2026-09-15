import assert from 'node:assert/strict'
import { request } from 'node:http'
import { readFile, access, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'

const send = (body, path = '/execute', headers = {}) => new Promise((resolve, reject) => {
  const req = request({ socketPath: '/channel/execute.sock', path, method: 'POST', headers }, res => {
    let text = ''; res.on('data', b => { text += b }); res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.setTimeout(3000, () => req.destroy(new Error('Timeout')))
  req.on('error', reject); req.end(JSON.stringify(body))
})
const read = { id: 'read-1', kind: 'read', action: 'list', body: null }
if (process.argv[2] === 'denied') {
  assert.equal((await send(read)).status, 403)
  console.log(JSON.stringify({ staleOrRevoked: 'denied' }))
  process.exit(0)
}
const result = await send(read)
assert.equal(result.status, 200)
assert.ok(!result.text.includes('CANARY-'))
for (const extra of [{ owner: 'B1' }, { generation: 99 }, { approved: true }, { url: 'https://example.invalid' }]) {
  assert.equal((await send({ ...read, ...extra })).status, 403)
}
assert.equal((await send(read, '/execute', { 'X-Owner': 'B1' })).status, 403)
for (const path of ['/credentials', '/approve', '/advance', '/reconcile']) assert.equal((await send(read, path)).status, 403)
const write = { id: 'unapproved', kind: 'write', action: 'create', body: { hours: 8 } }
assert.equal((await send(write)).status, 403)
assert.equal((await send({ ...write, id: 'approved-once', body: { hours: 80 } })).status, 403)
assert.equal((await send({ ...write, id: 'approved-once' })).status, 200)
assert.equal((await send({ ...write, id: 'approved-once' })).status, 200)
for (const path of ['/channels', '/var/run/docker.sock', '/secrets', '/root/.agents', '/other-owner']) {
  await assert.rejects(access(path))
}
await assert.rejects(writeFile('/lab/docker/runner.mjs', 'tamper'))
const environment = await readFile('/proc/self/environ', 'utf8')
assert.ok(!environment.includes('CANARY-'))
const status = await readFile('/proc/self/status', 'utf8')
assert.match(status, /CapEff:\s+0000000000000000/)
assert.match(status, /NoNewPrivs:\s+1/)
assert.notEqual(process.getuid(), 0)
const interfaces = await readFile('/proc/net/dev', 'utf8')
assert.ok(!interfaces.includes('eth0'))
const networkDenied = await new Promise(resolve => {
  const socket = createConnection({ host: '169.254.169.254', port: 80 })
  socket.setTimeout(1500, () => { socket.destroy(); resolve(true) })
  socket.on('error', () => resolve(true)); socket.on('connect', () => { socket.destroy(); resolve(false) })
})
assert.equal(networkDenied, true)
console.log(JSON.stringify({ socketIdentity: 'bound', credentials: 'absent', writes: 'grant-bound', network: 'none', privilege: 'none' }))
