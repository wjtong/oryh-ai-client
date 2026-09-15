import { afterEach, expect, it, vi } from 'vitest'
import { RuntimePool } from '../src/runtime-pool.js'
import { startNativeRuntime } from '../src/native-runtime.js'
const A = 'a'.repeat(64), B = 'b'.repeat(64)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
function setup(idleMs = 0, capacity = 2) {
  const state = { delay: undefined as Promise<void> | undefined, stopDelay: undefined as Promise<void> | undefined, fail: false, failStop: false }
  const controllers: AbortController[] = [], stops = vi.fn(async () => { await state.stopDelay; if (state.failStop) throw new Error('probe stop failure') })
  const start = vi.fn(async (owner: string, generation: number, _signal: AbortSignal) => {
    await state.delay
    if (state.fail) throw new Error('probe startup failure')
    const controller = new AbortController(); controllers.push(controller)
    return { value: { owner, generation }, signal: controller.signal, stop: stops }
  })
  const pool = new RuntimePool({ start, capacity, idleMs }); cleanup.push(() => pool.close())
  return { pool, state, start, controllers, stops }
}
const signal = () => new AbortController().signal
it('deduplicates 20 concurrent acquisitions and retains a shared Host until the last release', async () => {
  const f = setup(), leases = await Promise.all(Array.from({ length: 20 }, () => f.pool.acquire(A, signal())))
  expect(f.start).toHaveBeenCalledTimes(1)
  await Promise.all(leases.slice(1).map(l => l.release()))
  expect(f.stops).not.toHaveBeenCalled(); expect(f.pool.resolve(leases[0]!)).toEqual({ owner: A, generation: 1 })
  await leases[0]!.release(); expect(f.stops).toHaveBeenCalledTimes(1)
})
it('cancelling one startup waiter does not cancel another', async () => {
  const f = setup(); let finish!: () => void
  f.state.delay = new Promise<void>(r => { finish = r })
  const abort = new AbortController()
  const first = f.pool.acquire(A, abort.signal), second = f.pool.acquire(A, signal())
  abort.abort(); await expect(first).rejects.toThrow(); finish()
  expect((await second).signal.aborted).toBe(false); expect(f.start).toHaveBeenCalledTimes(1)
})
it('cleans a late start after every waiter cancels', async () => {
  const f = setup(); let finish!: () => void
  f.state.delay = new Promise<void>(r => { finish = r })
  const abort = new AbortController(), acquiring = f.pool.acquire(A, abort.signal)
  abort.abort(); await expect(acquiring).rejects.toThrow(); finish()
  await vi.waitFor(() => expect(f.stops).toHaveBeenCalledTimes(1))
})
it('refuses extra owners at capacity but admits another lease on a live owner', async () => {
  const f = setup(0, 1), a = await f.pool.acquire(A, signal())
  await expect(f.pool.acquire(B, signal())).rejects.toThrow()
  const other = await f.pool.acquire(A, signal())
  await a.release(); await other.release()
  expect((await f.pool.acquire(B, signal())).owner).toBe(B)
})
it('releases idempotently and refuses forged, foreign and released leases', async () => {
  const f = setup(), a = await f.pool.acquire(A, signal()), other = setup()
  expect(() => f.pool.resolve({ ...a })).toThrow(); expect(() => other.pool.resolve(a)).toThrow()
  await a.release(); await a.release()
  expect(f.stops).toHaveBeenCalledTimes(1); expect(() => f.pool.resolve(a)).toThrow()
})
it('does not start a replacement until cleanup finishes, then advances generation', async () => {
  const f = setup(), a = await f.pool.acquire(A, signal()); let finish!: () => void
  f.state.stopDelay = new Promise<void>(r => { finish = r })
  const releasing = a.release(), next = f.pool.acquire(A, signal())
  await Promise.resolve(); expect(f.start).toHaveBeenCalledTimes(1)
  finish(); await releasing
  expect((await next).generation).toBe(2)
})
it('idle reacquisition reuses a Host; elapsed idle time reclaims it', async () => {
  const f = setup(40), a = await f.pool.acquire(A, signal()); await a.release()
  const b = await f.pool.acquire(A, signal()); expect(b.generation).toBe(1)
  await b.release(); await vi.waitFor(() => expect(f.stops).toHaveBeenCalledTimes(1))
  expect((await f.pool.acquire(A, signal())).generation).toBe(2)
})
it('a runtime crash invalidates all leases and allows a new generation only after cleanup', async () => {
  const f = setup(), a = await f.pool.acquire(A, signal()), b = await f.pool.acquire(A, signal())
  f.controllers[0]!.abort()
  expect(() => f.pool.resolve(a)).toThrow()
  await vi.waitFor(() => expect(a.signal.aborted && b.signal.aborted).toBe(true))
  expect((await f.pool.acquire(A, signal())).generation).toBe(2)
})
it('startup failure is retryable with a new generation', async () => {
  const f = setup(); f.state.fail = true
  await expect(f.pool.acquire(A, signal())).rejects.toThrow()
  f.state.fail = false; const next = await f.pool.acquire(A, signal()); expect(next.generation).toBe(2)
  await Promise.resolve(); expect(f.pool.resolve(next).owner).toBe(A)
  expect((await f.pool.acquire(A, signal())).generation).toBe(2); expect(f.start).toHaveBeenCalledTimes(2)
})
it('cleanup failure quarantines the owner and reports failure instead of starting over', async () => {
  const f = setup(), a = await f.pool.acquire(A, signal()); f.state.failStop = true
  await expect(a.release()).rejects.toThrow()
  await expect(f.pool.acquire(A, signal())).rejects.toThrow()
  await expect(f.pool.close()).rejects.toThrow()
  cleanup.pop() // Expected failed cleanup is already asserted; do not suppress other fixture errors.
})
it('shutdown cancels all leases and permanently closes admission', async () => {
  const f = setup(), a = await f.pool.acquire(A, signal())
  await f.pool.close(); expect(a.signal.aborted).toBe(true)
  await expect(f.pool.acquire(A, signal())).rejects.toThrow()
})
it('starts actual isolated public Harness Hosts, authenticates internally and serves the native frontend', async () => {
  const start = vi.fn(startNativeRuntime), pool = new RuntimePool({ start, capacity: 2, idleMs: 0 }); cleanup.push(() => pool.close())
  const [a, a2, b] = await Promise.all([pool.acquire(A, signal()), pool.acquire(A, signal()), pool.acquire(B, signal())])
  const ta = pool.resolve(a), tb = pool.resolve(b)
  expect(start).toHaveBeenCalledTimes(2); expect(ta.port).not.toBe(tb.port)
  expect(ta.internalCookie).not.toBe(tb.internalCookie)
  const query = (port: number, cookie: string) => fetch(`http://127.0.0.1:${port}/api/p0-runtime`, { headers: { cookie } })
  expect(await (await query(ta.port, ta.internalCookie)).json()).toEqual({ owner: A, generation: 1 })
  expect((await query(tb.port, ta.internalCookie)).ok).toBe(false)
  expect((await fetch(`http://127.0.0.1:${ta.port}/`, { headers: { cookie: ta.internalCookie } })).status).toBe(200)
  await a.release(); expect((await query(ta.port, ta.internalCookie)).ok).toBe(true)
  await a2.release(); await expect(query(ta.port, ta.internalCookie)).rejects.toThrow()
  expect((await query(tb.port, tb.internalCookie)).ok).toBe(true)
})
