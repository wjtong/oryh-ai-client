import { describe, expect, it } from 'vitest'
import { LabBroker, Denied, OutcomeUnknown, ownerKey, type Channel, type Operation, type Owner, type UpstreamRequest } from '../src/broker.js'

const a: Owner = { deployment: 'test', tenant: 'A', user: '1' }
const b: Owner = { deployment: 'test', tenant: 'B', user: '1' }
const write: Operation = { id: 'op-1', kind: 'write', action: 'create', body: { hours: 8, date: '2026-09-14' } }
function setup(upstream?: (r: UpstreamRequest) => Promise<void>) {
  let now = 1000
  const calls: UpstreamRequest[] = []
  const broker = new LabBroker({ list: 'read', create: 'write' }, async r => { calls.push(r); await upstream?.(r) }, () => now)
  broker.register(a, 'SYNTHETIC-A-ONLY')
  broker.register(b, 'SYNTHETIC-B-ONLY')
  return { broker, calls, ca: broker.open(a), cb: broker.open(b), tick: () => { now += 2000 } }
}

describe('P0 trusted broker contracts (not a real approval integration)', () => {
  it('distinguishes delimiter collisions and invalid owners', () => {
    expect(ownerKey({ deployment: 'a/b', tenant: 'c', user: 'd' })).not.toBe(ownerKey({ deployment: 'a', tenant: 'b/c', user: 'd' }))
    expect(() => ownerKey({ ...a, user: '' })).toThrow(Denied)
  })
  it('rejects manufactured channels even with correct owner and generation', async () => {
    const { broker, ca } = setup()
    await expect(broker.execute({ ...ca }, write)).rejects.toThrow(Denied)
  })
  it('binds credentials and idempotency namespaces to the channel, not natural person', async () => {
    const { broker, calls, ca, cb } = setup()
    broker.approve(ca, write, 1000); broker.approve(cb, write, 1000)
    await Promise.all([broker.execute(ca, write), broker.execute(cb, write)])
    expect(calls.map(x => x.credential)).toEqual(['SYNTHETIC-A-ONLY', 'SYNTHETIC-B-ONLY'])
    expect(calls[0]!.idempotencyKey).not.toBe(calls[1]!.idempotencyKey)
  })
  it('always re-queries reads instead of serving a stale write receipt cache', async () => {
    const { broker, ca, calls } = setup()
    const read: Operation = { id: 'refresh', kind: 'read', action: 'list', body: null }
    await broker.execute(ca, read); await broker.execute(ca, read)
    expect(calls).toHaveLength(2)
  })
  it('requires a grant and rejects a write disguised as a read', async () => {
    const { broker, ca, calls } = setup()
    await expect(broker.execute(ca, write)).rejects.toThrow(Denied)
    await expect(broker.execute(ca, { ...write, kind: 'read' })).rejects.toThrow(Denied)
    await expect(broker.execute(ca, { ...write, kind: 'read', action: 'toString' })).rejects.toThrow(Denied)
    expect(calls).toHaveLength(0)
  })
  it('rejects expired grants, mutated payloads and grants from another owner', async () => {
    const { broker, ca, cb, tick, calls } = setup()
    broker.approve(ca, write, 1000)
    await expect(broker.execute(cb, write)).rejects.toThrow(Denied)
    await expect(broker.execute(ca, { ...write, body: { hours: 80 } })).rejects.toThrow(Denied)
    tick()
    await expect(broker.execute(ca, write)).rejects.toThrow(Denied)
    expect(calls).toHaveLength(0)
  })
  it('accepts equivalent key order and returns receipt copies without credentials', async () => {
    const { broker, ca } = setup()
    broker.approve(ca, write, 1000)
    const receipt = await broker.execute(ca, { ...write, body: { date: '2026-09-14', hours: 8 } })
    expect(JSON.stringify(receipt)).not.toContain('SYNTHETIC')
    Object.assign(receipt, { state: 'unknown' })
    expect((await broker.execute(ca, write)).state).toBe('succeeded')
  })
  it('deduplicates a completed request but rejects reuse with a different payload', async () => {
    const { broker, ca, calls } = setup()
    broker.approve(ca, write, 1000)
    await broker.execute(ca, write); await broker.execute(ca, write)
    await expect(broker.execute(ca, { ...write, body: null })).rejects.toThrow(Denied)
    expect(calls).toHaveLength(1)
  })
  it('does not race two copies while the upstream is pending', async () => {
    let release!: () => void
    const { broker, ca, calls } = setup(() => new Promise(resolve => { release = resolve }))
    broker.approve(ca, write, 1000)
    const first = broker.execute(ca, write)
    await expect(broker.execute(ca, write)).rejects.toThrow(OutcomeUnknown)
    release(); await first
    expect(calls).toHaveLength(1)
  })
  it('does not retry a committed write after response loss; never leaks upstream errors', async () => {
    let committed = 0
    const { broker, ca, calls } = setup(async r => { committed++; throw new Error(r.credential) })
    broker.approve(ca, write, 1000)
    await expect(broker.execute(ca, write)).rejects.toThrow('Result must be reconciled before retry')
    await expect(broker.execute(ca, write)).rejects.toThrow(OutcomeUnknown)
    expect(committed).toBe(1); expect(calls).toHaveLength(1)
    broker.reconcile(ca, write, 'succeeded')
    expect((await broker.execute(ca, write)).state).toBe('succeeded')
    expect(committed).toBe(1)
  })
  it('denies an old generation including stale approval, but does not undo an in-flight write', async () => {
    let release!: () => void
    const { broker, ca, calls } = setup(() => new Promise(resolve => { release = resolve }))
    broker.approve(ca, write, 1000)
    const sent = broker.execute(ca, write)
    broker.advance(a)
    await expect(broker.execute(ca, write)).rejects.toThrow(Denied)
    const current = broker.open(a)
    await expect(broker.execute(current, { ...write, id: 'op-2' })).rejects.toThrow(Denied)
    release(); await sent
    expect((await broker.execute(current, write)).state).toBe('succeeded')
    expect(calls).toHaveLength(1)
  })
  it('cannot restore access after revocation or replay a previously completed receipt', async () => {
    const { broker, ca } = setup()
    broker.approve(ca, write, 1000); await broker.execute(ca, write)
    broker.revoke(a)
    expect(() => broker.open(a)).toThrow(Denied)
    expect(() => broker.advance(a)).toThrow(Denied)
    await expect(broker.execute(ca, write)).rejects.toThrow(Denied)
  })
  it('rejects invalid wire values and cannot mutate issued identity', async () => {
    const { broker, ca } = setup()
    expect(() => Object.assign(ca.owner, b)).toThrow()
    for (const body of [undefined, NaN, Infinity, new Date()]) {
      await expect(broker.execute(ca, { ...write, body })).rejects.toThrow(Denied)
    }
    await expect(broker.execute({} as Channel, write)).rejects.toThrow(Denied)
  })
})
