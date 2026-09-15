import { createHash } from 'node:crypto'

/** P0 fixture only: no real credentials, network transport, or persistent server composition. */
export interface Owner {
  readonly deployment: string
  readonly tenant: string
  readonly user: string
}
export interface Channel {
  readonly owner: Owner
  readonly generation: number
}
export interface Operation {
  readonly id: string
  readonly kind: 'read' | 'write'
  readonly action: string
  readonly body: unknown
}
export interface Receipt {
  readonly id: string
  readonly digest: string
  readonly state: 'sent' | 'succeeded' | 'unknown'
}
export interface UpstreamRequest extends Operation {
  readonly owner: Owner
  readonly idempotencyKey: string
  readonly credential: string
}
export class Denied extends Error {
  constructor() { super('Request denied') }
}
export class OutcomeUnknown extends Error {
  constructor() { super('Result must be reconciled before retry') }
}

/** Length-safe tuple encoding; e-mail or arbitrary input never becomes a filesystem path. */
export function ownerKey(owner: Owner): string {
  if ([owner.deployment, owner.tenant, owner.user].some(x => typeof x !== 'string' || !x || x.length > 200)) throw new Denied()
  return JSON.stringify([owner.deployment, owner.tenant, owner.user])
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  throw new Denied()
}
function validate(op: Operation): Operation {
  if (!op || typeof op.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(op.id)
    || (op.kind !== 'read' && op.kind !== 'write') || typeof op.action !== 'string') throw new Denied()
  // A stable defensive copy also rejects undefined/non-JSON payloads before approval hashing.
  return Object.freeze({ id: op.id, kind: op.kind, action: op.action, body: JSON.parse(canonical(op.body)) as unknown })
}
function digest(op: Operation): string {
  return createHash('sha256').update(canonical(op)).digest('hex')
}

/**
 * Lives in the trusted lab process. open(), approve(), revoke(), advance(), reconcile() are
 * control-plane methods and MUST NOT be exposed on the execution socket. Approval here is a
 * synthetic test decision, NOT a proven Harness UI approval. Production persistence is absent.
 */
export class LabBroker {
  readonly #channels = new WeakSet<Channel>()
  readonly #principals = new Map<string, { generation: number; credential: string; active: boolean }>()
  readonly #grants = new Map<string, { digest: string; generation: number; expires: number }>()
  readonly #receipts = new Map<string, Receipt>()
  readonly #actions: Readonly<Record<string, 'read' | 'write'>>

  constructor(
    actions: Readonly<Record<string, 'read' | 'write'>>,
    private readonly upstream: (request: UpstreamRequest) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) { this.#actions = Object.freeze({ ...actions }) }

  register(owner: Owner, credential: string): void {
    const key = ownerKey(owner)
    if (this.#principals.has(key) || !credential) throw new Denied()
    this.#principals.set(key, { generation: 1, credential, active: true })
  }
  open(owner: Owner): Channel {
    const record = this.#principals.get(ownerKey(owner))
    if (!record?.active) throw new Denied()
    const channel = Object.freeze({ owner: Object.freeze({ ...owner }), generation: record.generation })
    this.#channels.add(channel)
    return channel
  }
  advance(owner: Owner): void {
    const p = this.#principals.get(ownerKey(owner))
    if (!p?.active) throw new Denied()
    p.generation++
  }
  revoke(owner: Owner): void {
    const p = this.#principals.get(ownerKey(owner))
    if (p) { p.active = false; p.generation++ }
  }
  private principal(channel: Channel) {
    if (!this.#channels.has(channel)) throw new Denied()
    const p = this.#principals.get(ownerKey(channel.owner))
    if (!p?.active || p.generation !== channel.generation) throw new Denied()
    return p
  }
  private key(channel: Channel, id: string): string { return JSON.stringify([ownerKey(channel.owner), id]) }
  approve(channel: Channel, input: Operation, ttlMs: number): void {
    this.principal(channel)
    const op = validate(input)
    if (op.kind !== 'write' || this.#actions[op.action] !== 'write' || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 300_000) throw new Denied()
    this.#grants.set(this.key(channel, op.id), { digest: digest(op), generation: channel.generation, expires: this.now() + ttlMs })
  }
  async execute(channel: Channel, input: Operation): Promise<Receipt> {
    this.principal(channel)
    const op = validate(input)
    if (!Object.hasOwn(this.#actions, op.action) || this.#actions[op.action] !== op.kind) throw new Denied()
    const key = this.key(channel, op.id)
    const hash = digest(op)
    const previous = op.kind === 'write' ? this.#receipts.get(key) : undefined
    if (previous) {
      if (previous.digest !== hash) throw new Denied()
      if (previous.state !== 'succeeded') throw new OutcomeUnknown()
      return { ...previous }
    }
    if (op.kind === 'write') {
      const grant = this.#grants.get(key)
      if (!grant || grant.generation !== channel.generation || grant.digest !== hash || grant.expires <= this.now()) throw new Denied()
      this.#grants.delete(key)
    }
    // In this in-process experiment the synchronous section is atomic. A production adapter
    // requires a database transaction, durable receipt, and server-side idempotency contract.
    const sent: Receipt = { id: op.id, digest: hash, state: 'sent' }
    if (op.kind === 'write') this.#receipts.set(key, sent)
    try {
      const p = this.principal(channel)
      await this.upstream({ ...op, owner: channel.owner, credential: p.credential,
        idempotencyKey: createHash('sha256').update(key).digest('hex') })
      const done: Receipt = { ...sent, state: 'succeeded' }
      if (op.kind === 'write') this.#receipts.set(key, done)
      return { ...done }
    } catch {
      if (op.kind === 'write') this.#receipts.set(key, { ...sent, state: 'unknown' })
      // Never return upstream error text: it could contain a credential or request headers.
      throw new OutcomeUnknown()
    }
  }
  /** Test-only authoritative recovery decision; no caller-supplied success over the socket. */
  reconcile(channel: Channel, input: Operation, outcome: 'succeeded'): void {
    this.principal(channel)
    const op = validate(input)
    const key = this.key(channel, op.id)
    const previous = this.#receipts.get(key)
    if (!previous || previous.digest !== digest(op) || previous.state !== 'unknown' || outcome !== 'succeeded') throw new Denied()
    this.#receipts.set(key, { ...previous, state: outcome })
  }
}
