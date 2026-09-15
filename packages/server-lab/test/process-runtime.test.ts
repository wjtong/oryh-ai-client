import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, symlink, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimePool } from '../src/runtime-pool.js'
import { processRuntimeFactory } from '../src/process-runtime.js'
const A = 'a'.repeat(64), B = 'b'.repeat(64)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'oryh-process-p0-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const factory = processRuntimeFactory(root)
  const pool = new RuntimePool({ start: factory, capacity: 2, idleMs: 0 }); cleanup.push(() => pool.close())
  return { root, pool, factory }
}
const signal = () => new AbortController().signal
async function workspace(target: { port: number; internalCookie: string }) {
  const response = await fetch(`http://127.0.0.1:${target.port}/api/p0-workspace`, { headers: { cookie: target.internalCookie } })
  expect(response.status).toBe(200); return response.json()
}
it('runs separate processes and restores the same native workspace after restart', async () => {
  const f = await setup(), a = await f.pool.acquire(A, signal()), b = await f.pool.acquire(B, signal())
  const ta = f.pool.resolve(a), tb = f.pool.resolve(b)
  expect(ta.pid).not.toBe(process.pid); expect(tb.pid).not.toBe(ta.pid)
  const wa = await workspace(ta), wb = await workspace(tb)
  expect(wa.id).not.toBe(wb.id)
  expect(wa.title).toBe('我的工作区')
  await a.release()
  expect(() => process.kill(ta.pid, 0)).toThrow()
  const again = await f.pool.acquire(A, signal()), next = f.pool.resolve(again)
  expect(next.pid).not.toBe(ta.pid); expect(again.generation).toBe(2)
  expect(await workspace(next)).toEqual(wa)
  expect(await workspace(tb)).toEqual(wb)
  expect((await readdir(join(f.root, A, 'storage'))).length).toBeGreaterThan(0)
}, 30_000)
it('prevents another supervisor from opening the same owner directory', async () => {
  const f = await setup(), a = await f.pool.acquire(A, signal())
  await expect(f.factory(A, 9, signal())).rejects.toThrow('already running')
  expect((await workspace(f.pool.resolve(a))).id).toBeTruthy()
}, 30_000)
it('rejects symlinked owner roots and invalid identifiers before starting a process', async () => {
  const f = await setup(), outside = join(f.root, 'outside')
  await mkdir(outside, { mode: 0o700 }); await symlink(outside, join(f.root, A))
  await expect(f.factory(A, 1, signal())).rejects.toThrow('Unsafe owner directory')
  await expect(f.factory('../outside', 1, signal())).rejects.toThrow('Invalid owner')
})
it('reclaims the directory lock after startup cancellation', async () => {
  const f = await setup(), abort = new AbortController()
  const starting = f.factory(A, 1, abort.signal); abort.abort()
  await expect(starting).rejects.toThrow()
  const a = await f.pool.acquire(A, signal())
  expect((await workspace(f.pool.resolve(a))).id).toBeTruthy()
}, 30_000)

it('invalidates leases after an unexpected exit and reopens only after lock cleanup', async () => {
  const f = await setup(), a = await f.pool.acquire(A, signal()), target = f.pool.resolve(a)
  const before = await workspace(target)
  process.kill(target.pid, 'SIGKILL')
  await new Promise<void>(resolve => { if (a.signal.aborted) resolve(); else a.signal.addEventListener('abort', () => resolve(), { once: true }) })
  expect(() => f.pool.resolve(a)).toThrow()
  const next = await f.pool.acquire(A, signal())
  expect(next.generation).toBe(2); expect(await workspace(f.pool.resolve(next))).toEqual(before)
}, 30_000)

it('persists native user/assistant events across process restart without exposing another owner history', async () => {
  const f = await setup(), a = await f.pool.acquire(A, signal()), b = await f.pool.acquire(B, signal())
  const ta = f.pool.resolve(a), tb = f.pool.resolve(b)
  const created = await fetch(`http://127.0.0.1:${ta.port}/api/p0-session`, { method: 'POST', headers: { cookie: ta.internalCookie, origin: `http://127.0.0.1:${ta.port}` } })
  expect(created.status).toBe(200)
  const original = await created.json()
  expect(original.events.map((e: { type: string }) => e.type)).toContain('assistant/message')
  const read = (t: typeof ta) => fetch(`http://127.0.0.1:${t.port}/api/p0-session?id=${original.id}`, { headers: { cookie: t.internalCookie } })
  expect((await read(tb)).status).toBe(404)
  await a.release()
  const next = await f.pool.acquire(A, signal())
  expect(await (await read(f.pool.resolve(next))).json()).toEqual(original)
  expect((await read(tb)).status).toBe(404)
}, 30_000)

it('recovers flushed session events after a forced process exit', async () => {
  const f = await setup(), a = await f.pool.acquire(A, signal()), ta = f.pool.resolve(a)
  const result = await fetch(`http://127.0.0.1:${ta.port}/api/p0-session`, { method: 'POST', headers: { cookie: ta.internalCookie, origin: `http://127.0.0.1:${ta.port}` } })
  expect(result.status).toBe(200); const original = await result.json()
  process.kill(ta.pid, 'SIGKILL')
  await new Promise<void>(resolve => { if (a.signal.aborted) resolve(); else a.signal.addEventListener('abort', () => resolve(), { once: true }) })
  const next = f.pool.resolve(await f.pool.acquire(A, signal()))
  const restored = await fetch(`http://127.0.0.1:${next.port}/api/p0-session?id=${original.id}`, { headers: { cookie: next.internalCookie } })
  expect(await restored.json()).toEqual(original)
}, 30_000)
