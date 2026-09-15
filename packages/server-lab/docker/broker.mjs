// Synthetic upstream ONLY. This process stays outside every execution container.
import { randomUUID } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import { LabBroker } from '../lib/broker.js'
import { executionSocket } from '../lib/socket.js'

const names = ['A1', 'A2', 'B1', 'B3']
const owners = names.map(name => ({ deployment: 'synthetic', tenant: name[0], user: name[1] }))
const calls = []
const keys = new Map()
const broker = new LabBroker({ list: 'read', create: 'write' }, async request => {
  if (request.credential !== keys.get(JSON.stringify(request.owner))) throw new Error('Incorrect actor')
  calls.push({ owner: request.owner, operation: request.id })
})
for (let i = 0; i < names.length; i++) {
  const owner = owners[i]
  const secret = `CANARY-${randomUUID()}`
  keys.set(JSON.stringify(owner), secret)
  broker.register(owner, secret)
  await chmod(`/channels/${names[i]}`, 0o755)
  const channel = broker.open(owner)
  // This grant is issued by this trusted fixture, never by the execution-side request.
  broker.approve(channel, { id: 'approved-once', kind: 'write', action: 'create', body: { hours: 8 } }, 300000)
  await executionSocket(`/channels/${names[i]}/execute.sock`, broker, channel)
}
process.on('SIGUSR1', () => { broker.advance(owners[0]); console.log('ADVANCED') })
process.on('SIGUSR2', () => { broker.revoke(owners[1]); console.log('REVOKED') })
process.on('SIGTERM', async () => {
  // Only test actor/operation IDs; no credentials or request bodies.
  await writeFile('/tmp/actors.json', JSON.stringify(calls))
  process.exit(0)
})
console.log('READY')
