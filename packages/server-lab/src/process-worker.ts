/** Fixed trusted child entry; configuration arrives only on the parent IPC channel. */
import { startNativeRuntime } from './native-runtime.js'
process.umask(0o077)
const abort = new AbortController()
let runtime: Awaited<ReturnType<typeof startNativeRuntime>> | undefined
let started = false
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true; abort.abort()
  if (runtime) { await runtime.stop(); process.exit(0) }
  else if (!started) process.exit(0)
}
process.on('SIGTERM', () => { void stop().catch(() => process.exit(1)) })
process.on('disconnect', () => { void stop().catch(() => process.exit(1)) })
process.once('message', async message => {
  started = true
  try {
    const config = message as { owner: string; generation: number; root: string }
    if (!/^[a-f0-9]{64}$/.test(config.owner) || !Number.isSafeInteger(config.generation) || config.generation < 1 || typeof config.root !== 'string') throw new Error('Invalid worker configuration')
    runtime = await startNativeRuntime(config.owner, config.generation, abort.signal, config.root)
    if (stopping) { await runtime.stop(); process.exit(0) }
    process.send?.({ type: 'ready', ...runtime.value })
  } catch { process.send?.({ type: 'failed' }); process.exit(1) }
})
