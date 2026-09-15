import { fork } from 'node:child_process'
import { mkdir, lstat, realpath, rmdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { NativeTarget } from './native-runtime.js'
import type { RunningRuntime } from './runtime-pool.js'

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe owner directory')
}
/** One trusted Host process per owner; same-UID processes are not an untrusted-code sandbox. */
export function processRuntimeFactory(base: string) {
  return async (owner: string, generation: number, signal: AbortSignal): Promise<RunningRuntime<NativeTarget & { pid: number }>> => {
    signal.throwIfAborted()
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('Invalid owner')
    const root = await realpath(base)
    await privateDirectory(root)
    const ownerRoot = join(root, owner)
    await privateDirectory(ownerRoot)
    for (const sub of ['home', 'workspace', 'storage', 'sessions']) await privateDirectory(join(ownerRoot, sub))
    const lock = join(ownerRoot, '.host-lock')
    await mkdir(lock, { mode: 0o700 }).catch(() => { throw new Error('Owner already running or requires stale-lock recovery') })
    let child: ReturnType<typeof fork>
    try {
      signal.throwIfAborted()
      child = fork(new URL('../lib/process-worker.js', import.meta.url), [], {
        cwd: join(ownerRoot, 'workspace'), execArgv: [],
        env: { PATH: dirname(process.execPath), HOME: join(ownerRoot, 'home'), DSH_HOME: join(ownerRoot, 'home'), NODE_ENV: 'production' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
    } catch { await rmdir(lock); throw new Error('Host process startup failed') }
    const lifetime = new AbortController()
    const exited = new Promise<void>(resolve => { child.once('exit', () => { lifetime.abort(); resolve() }); child.once('error', () => { lifetime.abort(); if (!child.pid) resolve() }) })
    let stopping: Promise<void> | undefined
    const stop = () => stopping ??= (async () => {
      lifetime.abort()
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref()
      try { await exited; await rmdir(lock) } finally { clearTimeout(timer); signal.removeEventListener('abort', cancelled) }
    })()
    const cancelled = () => { void stop().catch(() => {}) }
    signal.addEventListener('abort', cancelled, { once: true })
    try {
      const target = await new Promise<NativeTarget>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Host startup timed out')), 20_000)
        const failed = () => reject(new Error('Host process startup failed'))
        child.once('exit', failed); child.once('error', failed)
        child.once('message', value => {
          const message = value as { type?: string; port?: number; internalCookie?: string }
          clearTimeout(timer); child.removeListener('exit', failed); child.removeListener('error', failed)
          if (message.type !== 'ready' || !Number.isSafeInteger(message.port) || message.port! < 1 || message.port! > 65535 ||
            typeof message.internalCookie !== 'string' || !message.internalCookie || /[\r\n]/.test(message.internalCookie)) failed()
          else resolve({ port: message.port!, internalCookie: message.internalCookie })
        })
        void exited.then(() => { clearTimeout(timer); failed() })
        child.send({ owner, generation, root: ownerRoot }, error => { if (error) { clearTimeout(timer); failed() } })
      })
      signal.throwIfAborted(); lifetime.signal.throwIfAborted()
      return { value: { ...target, pid: child.pid! }, signal: lifetime.signal, stop }
    } catch { await stop(); throw new Error('Host process startup failed') }
  }
}
