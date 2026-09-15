import type { RuntimeLease } from './login-routes.js'
export interface RunningRuntime<T> { readonly value: T; readonly signal: AbortSignal; stop(): Promise<void> }
interface Entry<T> {
  owner: string; generation: number; phase: 'starting' | 'ready' | 'stopping' | 'failed'
  abort: AbortController; ready: Promise<RunningRuntime<T>>; runtime?: RunningRuntime<T>
  borrowers: Set<Borrower<T>>; waiters: number; idle?: ReturnType<typeof setTimeout>; stopping?: Promise<void>
}
interface Borrower<T> { entry: Entry<T>; abort: AbortController; active: boolean; detach(): void }
const unavailable = () => new Error('Runtime unavailable or at capacity')
function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(unavailable())
    signal.addEventListener('abort', cancelled, { once: true })
    promise.then(resolve, () => reject(unavailable())).finally(() => signal.removeEventListener('abort', cancelled))
  })
}

/** Trusted per-owner lifecycle manager. It never owns an end-user's OAuth grant. */
export class RuntimePool<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly generations = new Map<string, number>()
  private readonly leases = new WeakMap<RuntimeLease, Borrower<T>>()
  private closed = false
  constructor(private readonly options: {
    start: (owner: string, generation: number, signal: AbortSignal) => Promise<RunningRuntime<T>>
    capacity: number; idleMs?: number
  }) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1 || options.capacity > 1000 ||
      !Number.isFinite(options.idleMs ?? 30_000) || (options.idleMs ?? 30_000) < 0) throw unavailable()
  }
  async acquire(owner: string, signal: AbortSignal): Promise<RuntimeLease> {
    signal.throwIfAborted()
    if (this.closed || !/^[a-f0-9]{64}$/.test(owner)) throw unavailable()
    let entry = this.entries.get(owner)
    if (entry?.phase === 'failed') throw unavailable()
    if (entry?.phase === 'stopping') { await wait(entry.stopping!, signal); return this.acquire(owner, signal) }
    if (!entry) {
      if (this.entries.size >= this.options.capacity) throw unavailable()
      const generation = (this.generations.get(owner) ?? 0) + 1
      this.generations.set(owner, generation)
      const abort = new AbortController()
      entry = { owner, generation, abort, phase: 'starting', borrowers: new Set(), waiters: 0, ready: undefined! }
      const current = entry
      // Reserve before calling a factory, including factories with synchronous work.
      this.entries.set(owner, current)
      current.ready = Promise.resolve().then(() => this.options.start(owner, generation, abort.signal)).then(runtime => {
        current.runtime = runtime
        if (current.phase === 'starting') current.phase = 'ready'
        const crashed = () => { void this.stop(current).catch(() => {}) }
        runtime.signal.addEventListener('abort', crashed, { once: true })
        if (runtime.signal.aborted) crashed()
        return runtime
      }, () => {
        if (current.phase === 'starting') { current.phase = 'failed'; current.abort.abort(); if (this.entries.get(owner) === current) this.entries.delete(owner) }
        throw unavailable()
      })
      void current.ready.catch(() => {})
    }
    if (entry.idle) { clearTimeout(entry.idle); delete entry.idle }
    entry.waiters++
    try {
      const runtime = await wait(entry.ready, signal)
      if (this.closed || entry.phase !== 'ready' || entry.abort.signal.aborted || runtime.signal.aborted) throw unavailable()
      signal.throwIfAborted()
      const borrower: Borrower<T> = { entry, abort: new AbortController(), active: true, detach: () => {} }
      const released = () => { void this.release(borrower).catch(() => {}) }
      signal.addEventListener('abort', released, { once: true })
      borrower.detach = () => signal.removeEventListener('abort', released)
      entry.borrowers.add(borrower)
      const lease: RuntimeLease = Object.freeze({ owner, generation: entry.generation, signal: borrower.abort.signal, release: () => this.release(borrower) })
      this.leases.set(lease, borrower)
      return lease
    } finally {
      entry.waiters--
      this.unused(entry)
    }
  }
  /** Private route resolution: a serialized or foreign lease cannot choose a target. */
  resolve(lease: RuntimeLease): T {
    const borrower = this.leases.get(lease), entry = borrower?.entry
    if (!borrower?.active || borrower.abort.signal.aborted || entry?.phase !== 'ready' || entry.abort.signal.aborted || entry.runtime?.signal.aborted) throw unavailable()
    return entry.runtime!.value
  }
  private async release(borrower: Borrower<T>) {
    if (!borrower.active) return
    borrower.active = false; borrower.detach(); borrower.abort.abort(); borrower.entry.borrowers.delete(borrower)
    this.unused(borrower.entry)
    if (borrower.entry.stopping) await borrower.entry.stopping
  }
  private unused(entry: Entry<T>) {
    if (entry.waiters || entry.borrowers.size || entry.phase === 'stopping' || entry.phase === 'failed' || entry.idle) return
    if (entry.phase === 'starting' || this.closed || (this.options.idleMs ?? 30_000) === 0) { void this.stop(entry).catch(() => {}); return }
    entry.idle = setTimeout(() => { delete entry.idle; void this.stop(entry).catch(() => {}) }, this.options.idleMs ?? 30_000)
    entry.idle.unref()
  }
  private stop(entry: Entry<T>): Promise<void> {
    if (entry.stopping) return entry.stopping
    entry.phase = 'stopping'
    if (entry.idle) { clearTimeout(entry.idle); delete entry.idle }
    // Publish the stop promise before abort callbacks can re-enter stop().
    entry.stopping = Promise.resolve().then(async () => {
      entry.abort.abort()
      for (const borrower of entry.borrowers) { borrower.active = false; borrower.detach(); borrower.abort.abort() }
      entry.borrowers.clear()
      let runtime: RunningRuntime<T>
      try { runtime = await entry.ready } catch { if (this.entries.get(entry.owner) === entry) this.entries.delete(entry.owner); return }
      try { await runtime.stop() } catch { entry.phase = 'failed'; throw unavailable() }
      if (this.entries.get(entry.owner) === entry) this.entries.delete(entry.owner)
    })
    return entry.stopping
  }
  /** Explicit invalidation kills every lease in this generation before a replacement can start. */
  async invalidate(owner: string): Promise<void> { const entry = this.entries.get(owner); if (entry) await this.stop(entry) }
  async close(): Promise<void> {
    this.closed = true
    const results = await Promise.allSettled([...this.entries.values()].map(entry => this.stop(entry)))
    if (results.some(r => r.status === 'rejected')) throw unavailable()
  }
}
