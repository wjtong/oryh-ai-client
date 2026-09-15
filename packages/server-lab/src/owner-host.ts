/**
 * Start one person's ORYH Host on the server: the real `dsh` launcher running the prepared
 * `oryh-server` Profile, as a child process with an IPC channel (docs/33 §2–3).
 *
 * The child gets its own HOME and DSH_HOME under the owner's private data root, the deployment's
 * model configuration, and nothing about ORYH but who is signed in — which it asks for over IPC. Its
 * ORYH requests come back over the same channel to the broker, where the grant is. DSH prints a
 * one-time launch link on startup; this process alone reads it and exchanges it for DSH's session
 * cookie, which the owner-domain proxy attaches to the person's requests. The browser never sees it.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { hkdfSync } from 'node:crypto'
import { lstat, mkdir, readlink, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { answerOwnerHostConfig, serveOwnerRequests, type IpcChannel, type OryhIdentity } from '@oryh/ai-client-core'
import type { OwnerBroker } from './owner-broker.js'
import type { RunningRuntime } from './runtime-pool.js'

/** What the owner-domain proxy needs to reach this Host. Trusted transport data; never sent to a browser. */
export interface OwnerHostTarget {
  readonly port: number
  readonly internalCookie: string
  readonly pid: number
}

export interface OwnerHostOptions {
  /** Private per-owner roots are created under this directory. */
  readonly dataRoot: string
  /** Package directories of `@oryh/dsh-bundle` and `@oryh/server-bundle`, layered over the web template. */
  readonly bundles: { readonly business: string; readonly server: string }
  /** Deployment secret that owners' draft-encryption secrets are derived from; at least 32 bytes. */
  readonly storeMasterKey: Buffer
  /** Model configuration handed to every owner Host, e.g. DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL. */
  readonly modelEnvironment: Readonly<Record<string, string>>
  readonly origin: string
  readonly identity: OryhIdentity
  readonly broker: Pick<OwnerBroker, 'send'>
  /** Log Gateway admission decisions to the Host's stderr. */
  readonly traceAdmission?: boolean
  /** Whether this deployment admits writes (docs/34); the Host's chat stops describing itself as read-only. */
  readonly writes?: boolean
  /** Where the Host's own output goes; defaults to discarding it. */
  readonly log?: (line: string) => void
  readonly startupTimeoutMs?: number
}

const require = createRequire(import.meta.url)

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe owner directory')
}

/**
 * A `RuntimePool` start function for owner Hosts.
 * @param options - deployment wiring shared by every owner, plus a way to reach each owner's grant.
 * @returns the pool's factory: owner hash and generation in, a running Host out.
 */
export function ownerHostFactory(options: Omit<OwnerHostOptions, 'identity' | 'broker'> & { session(owner: string): { identity: OryhIdentity; broker: Pick<OwnerBroker, 'send'> } }) {
  return (owner: string, generation: number, signal: AbortSignal) => {
    const { identity, broker } = options.session(owner)
    return startOwnerHost(owner, generation, signal, { ...options, identity, broker })
  }
}

/**
 * Start one owner Host and wait until it can serve that person.
 * @param owner - the owner hash; the only value used to build paths.
 * @param generation - the pool's generation for this start.
 * @param signal - cancels the start and stops a started Host.
 * @param options - see `OwnerHostOptions`.
 * @returns the running Host, a signal that aborts when it exits, and `stop`.
 */
export async function startOwnerHost(owner: string, generation: number, signal: AbortSignal, options: OwnerHostOptions): Promise<RunningRuntime<OwnerHostTarget>> {
  signal.throwIfAborted()
  if (!/^[a-f0-9]{64}$/.test(owner) || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid owner Host request')
  if (options.storeMasterKey.length < 32) throw new Error('Store master key must be at least 32 bytes')
  const root = join(options.dataRoot, owner)
  const home = join(root, 'home'), dshHome = join(root, 'dsh'), workspace = join(root, 'workspace')
  for (const path of [options.dataRoot, root, home, dshHome, workspace]) await privateDirectory(path)
  await writeOwnerProfile(join(dshHome, 'profiles', 'oryh-server'), options.bundles)
  const lock = join(root, '.host-lock')
  await mkdir(lock, { mode: 0o700 }).catch(() => { throw new Error('Owner Host already running or needs stale-lock recovery') })

  let child: ChildProcess
  try {
    child = spawn(process.execPath, [require.resolve('@deepseek-ai/dsh/lib/bin.js'), '--profile', 'oryh-server', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: workspace,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: join(home, '.agents'),
        ORYH_OWNER_HOST: '1',
        ORYH_OWNER_WORKSPACE: workspace,
        ORYH_SERVER_PRESET_ROOT: join(options.bundles.server, 'presets'),
        DSH_TELEMETRY_DISABLED: '1',
        ...options.traceAdmission ? { ORYH_ADMISSION_TRACE: '1' } : {},
        ...options.modelEnvironment,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
  } catch (error) {
    await rmdir(lock)
    throw error
  }

  const lifetime = new AbortController()
  const exited = new Promise<void>(resolve => child.once('exit', () => { lifetime.abort(); resolve() }))
  const channel = child as unknown as IpcChannel
  const stopAnswering = answerOwnerHostConfig(channel, {
    origin: options.origin,
    identity: options.identity,
    storeSecret: Buffer.from(hkdfSync('sha256', options.storeMasterKey, Buffer.from(owner, 'hex'), 'oryh-owner-store', 32)).toString('base64'),
    capabilities: { shell: false, writes: options.writes === true },
  })
  const stopServing = serveOwnerRequests(channel, options.broker, lifetime.signal)

  let stopping: Promise<void> | undefined
  const stop = () => stopping ??= (async () => {
    stopAnswering(); stopServing()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const force = setTimeout(() => child.kill('SIGKILL'), 10_000)
      force.unref()
      await exited
      clearTimeout(force)
    }
    await rmdir(lock).catch(() => {})
  })()
  const cancelled = () => { void stop() }
  signal.addEventListener('abort', cancelled, { once: true })
  void exited.then(() => signal.removeEventListener('abort', cancelled))

  try {
    const launch = await launchUrl(child, options.log, AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(options.startupTimeoutMs ?? 120_000)]))
    const internalCookie = await exchange(launch)
    return { value: Object.freeze({ port: Number(launch.port), internalCookie, pid: child.pid! }), signal: lifetime.signal, stop }
  } catch (error) {
    await stop()
    throw error instanceof Error ? error : new Error('Owner Host startup failed')
  }
}

/**
 * Write this owner's `oryh-server` Profile: the web template's bundles plus the two ORYH bundles.
 *
 * Each owner gets a real directory rather than a link to a shared one. At every launch Harness links
 * the bundles' dependencies into the Profile it booted, through the path it booted it by; a Profile
 * shared through links would be rewritten to point into whichever owner launched last.
 */
async function writeOwnerProfile(directory: string, bundles: OwnerHostOptions['bundles']): Promise<void> {
  const packages = { '@oryh/dsh-bundle': bundles.business, '@oryh/server-bundle': bundles.server }
  await mkdir(join(directory, 'node_modules', '@oryh'), { recursive: true, mode: 0o700 })
  await writeFile(join(directory, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-oryh-server',
    private: true,
    dependencies: Object.fromEntries(Object.entries(packages).map(([name, dir]) => [name, `link:${dir}`])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...Object.keys(packages)], patchReload: 'startup' } },
  }, null, 2)}\n`)
  // No person-editable patch layer: restrictions live in @oryh/server-bundle.
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  for (const [name, dir] of Object.entries(packages)) {
    const link = join(directory, 'node_modules', name)
    try {
      if (await readlink(link) === dir) continue
      await unlink(link)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await symlink(dir, link, 'dir')
  }
}

/** Read the Host's output until DSH prints its launch link; relay the rest with the token removed. */
function launchUrl(child: ChildProcess, log: ((line: string) => void) | undefined, signal: AbortSignal): Promise<URL> {
  return new Promise((resolve, reject) => {
    let found = false
    // The last lines before a failed start, so the reason reaches the control process's log.
    const recent: string[] = []
    const onAbort = () => reject(new Error(`Owner Host did not start${recent.length ? `:\n${recent.join('\n')}` : ''}`))
    signal.addEventListener('abort', onAbort, { once: true })
    for (const stream of [child.stdout!, child.stderr!]) {
      let pending = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        pending += chunk
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/.exec(line)
          if (match && !found) {
            found = true
            signal.removeEventListener('abort', onAbort)
            resolve(new URL(match[1]!))
            log?.('owner Host ready')
          } else if (!match) {
            log?.(line)
            if (!found) { recent.push(line); if (recent.length > 30) recent.shift() }
          }
        }
      })
    }
  })
}

/** Exchange the launch token for DSH's session cookie, as a browser on that address would. */
function exchange(launch: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: launch.port, path: `${launch.pathname}${launch.search}`, method: 'GET' }, response => {
      response.resume()
      const cookie = response.headers['set-cookie']?.[0]?.split(';')[0]
      if (response.statusCode === 303 && cookie) resolve(cookie)
      else reject(new Error('Owner Host did not issue a session'))
    })
    req.on('error', reject)
    req.end()
  })
}
