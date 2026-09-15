/**
 * Run the ORYH server's control process from environment configuration (docs/33).
 *
 *   ORYH_CLIENT_PUBLIC_ORIGIN   where people sign in; default http://localhost:4300 (development)
 *   ORYH_CLIENT_OWNER_DOMAIN    owners are served from <label>.<this>; default the public host
 *   ORYH_SERVERS                JSON [{"id","label","issuer"}]; or ORYH_SERVER_ORIGIN for one server
 *   ORYH_DATA_ROOT              private root for every owner's data (required)
 *   ORYH_STORE_MASTER_KEY       base64, at least 32 bytes; generated into the data root when absent
 *   DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL, or ORYH_MODEL_API_KEY / ORYH_MODEL_BASE_URL
 *   ORYH_HOST_CAPACITY          owner Hosts running at once; default 2 (each takes ~0.6 GB)
 *   ORYH_HOST_IDLE_MS           stop an owner Host this long after its last browser; default 300000
 *   ORYH_ADMISSION_TRACE=1      log each owner Host's Gateway admission decisions
 *   ORYH_OAUTH_COMPACT          1/0: authorization request within 128 characters, for ORYH before calwbiz
 *                               ecab43d; default 1 for a localhost public origin, 0 otherwise
 *   ORYH_WRITES=0                read-only, as in M1; writes are otherwise admitted with receipts in <data root>/control
 *   ORYH_CONTROL_HOST / ORYH_CONTROL_PORT   listen address and port; default loopback in development, the public origin's port
 *
 * Development: `node --env-file=.env packages/server-lab/lib/control-main.js`, then open the public origin.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startControlServer } from './control-server.js'
import { startOwnerHost } from './owner-host.js'
import { SqliteReceiptStore } from './write-receipts.js'

// Receipts use Node's built-in SQLite, which still announces itself as experimental on first load.
const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return
  emitWarning(warning, ...rest)
}) as typeof process.emitWarning

const env = process.env
const publicOrigin = new URL(env.ORYH_CLIENT_PUBLIC_ORIGIN ?? 'http://localhost:4300').origin
const publicUrl = new URL(publicOrigin)
const loopbackDevelopment = publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicUrl.hostname)
const ownerDomain = env.ORYH_CLIENT_OWNER_DOMAIN ?? publicUrl.host
const servers = env.ORYH_SERVERS
  ? JSON.parse(env.ORYH_SERVERS) as { id: string; label: string; issuer: string }[]
  : [{ id: 'oryh', label: 'ORYH', issuer: new URL(required('ORYH_SERVER_ORIGIN')).origin }]
const dataRoot = required('ORYH_DATA_ROOT')
if (!isAbsolute(dataRoot)) throw new Error('ORYH_DATA_ROOT must be absolute')
const modelEnvironment = Object.fromEntries(Object.entries({
  DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY ?? env.ORYH_MODEL_API_KEY,
  DEEPSEEK_BASE_URL: env.DEEPSEEK_BASE_URL ?? env.ORYH_MODEL_BASE_URL,
}).filter((entry): entry is [string, string] => Boolean(entry[1])))
if (!modelEnvironment.DEEPSEEK_API_KEY) throw new Error('A model key is required: DEEPSEEK_API_KEY or ORYH_MODEL_API_KEY')
const packages = fileURLToPath(new URL('../../', import.meta.url))

function required(name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

/** The deployment's store master key: configured, or generated once and kept private in the data root. */
async function storeMasterKey(): Promise<Buffer> {
  if (env.ORYH_STORE_MASTER_KEY) return Buffer.from(env.ORYH_STORE_MASTER_KEY, 'base64')
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  await chmod(dataRoot, 0o700)
  const path = join(dataRoot, '.store-master-key')
  try { return Buffer.from(await readFile(path, 'utf8'), 'base64') } catch {
    const key = randomBytes(32)
    await writeFile(path, key.toString('base64'), { mode: 0o600, flag: 'wx' })
    return key
  }
}

const key = await storeMasterKey()
const receipts = env.ORYH_WRITES === '0' ? undefined : new SqliteReceiptStore(join(dataRoot, 'control', 'receipts.sqlite'), await import('node:sqlite'))
const owners = join(dataRoot, 'owners')
const port = Number(publicUrl.port || (publicUrl.protocol === 'https:' ? 443 : 80))
const control = await startControlServer({
  publicOrigin,
  ownerDomain,
  servers,
  loopbackDevelopment,
  ...receipts ? { receipts } : {},
  compactAuthorization: (env.ORYH_OAUTH_COMPACT ?? (loopbackDevelopment ? '1' : '0')) === '1',
  ...env.ORYH_CONTROL_HOST ? { listenHost: env.ORYH_CONTROL_HOST } : {},
  capacity: Number(env.ORYH_HOST_CAPACITY ?? 2),
  idleMs: Number(env.ORYH_HOST_IDLE_MS ?? 300_000),
  log: line => console.log(`oryh-server: ${line}`),
  startHost: (owner, generation, signal, session) => startOwnerHost(owner, generation, signal, {
    dataRoot: owners,
    bundles: { business: join(packages, 'dsh-bundle'), server: join(packages, 'server-bundle') },
    storeMasterKey: key,
    modelEnvironment,
    origin: session.broker.issuer,
    identity: session.identity,
    broker: session.broker,
    traceAdmission: env.ORYH_ADMISSION_TRACE === '1',
    writes: receipts !== undefined,
    log: line => console.log(`owner ${owner.slice(0, 8)}: ${line}`),
  }),
}, Number(env.ORYH_CONTROL_PORT ?? port))
console.log(`oryh-server: listening on ${control.port}; open ${publicOrigin}/`)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void control.close().finally(() => { receipts?.close(); process.exit(0) }) })
}
