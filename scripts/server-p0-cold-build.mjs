// Clones committed inputs into a fresh sibling layout; never modifies the user's Harness checkout.
// No Profile installation, browser launch, business endpoint, or credential access occurs here.
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, open, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const source = resolve(import.meta.dirname, '..')
const harnessSource = resolve(source, '../deepseek-harness')
const temp = await mkdtemp(join(tmpdir(), 'oryh-p0-cold-'))
const client = join(temp, 'oryh-ai-client'), harness = join(temp, 'deepseek-harness')
const report = { scope: 'Committed baseline only; does not include uncommitted implementation', clientCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), harnessCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: harnessSource, encoding: 'utf8' }).trim(), stages: [] }
let active
process.once('SIGINT', () => { active?.kill('SIGTERM'); process.exitCode = 1 })
async function run(label, cmd, args, cwd = temp) {
  const logPath = join(temp, `${report.stages.length}-${label}.log`)
  const log = await open(logPath, 'w', 0o600)
  console.log(`P0 cold build: ${label}`)
  let code
  try {
    code = await new Promise((resolveExit, reject) => {
      active = spawn(cmd, args, { cwd, env: { ...process.env, CI: '1' }, stdio: ['ignore', log.fd, log.fd] })
      active.once('error', reject); active.once('exit', resolveExit)
    })
  } finally { active = undefined; await log.close() }
  report.stages.push({ label, passed: code === 0, logPath })
  await writeFile(join(temp, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  if (code !== 0) throw new Error(`${label} failed; inspect ${logPath}`)
}
console.log(`Isolated cold-build workspace: ${temp}`)
try {
  await run('clone-client', 'git', ['clone', '--no-hardlinks', '--no-checkout', source, client])
  await run('checkout-client', 'git', ['checkout', '--detach', report.clientCommit], client)
  await run('clone-harness', 'git', ['clone', '--no-hardlinks', '--no-checkout', harnessSource, harness])
  await run('checkout-harness', 'git', ['checkout', '--detach', report.harnessCommit], harness)
  await run('install-harness', 'pnpm', ['install', '--frozen-lockfile'], harness)
  await run('patch-harness', 'git', ['apply', join(client, 'patches/deepseek-harness-external-remote.patch')], harness)
  await run('build-harness', 'pnpm', ['run', 'build'], harness)
  await run('install-client', 'pnpm', ['install', '--frozen-lockfile'], client)
  await run('verify-client', 'pnpm', ['run', 'verify'], client)
  const artifact = join(client, 'packages/dsh-host/lib/typert.remote-client.d.ts')
  const before = await readFile(artifact)
  await run('repeat-remote-generation', 'node', ['scripts/generate-dsh-remote.mjs'], client)
  const after = await readFile(artifact)
  if (!before.equals(after)) throw new Error('Remote declaration changed on repeat generation')
  report.declarationSha256 = createHash('sha256').update(after).digest('hex')
  await writeFile(join(temp, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log('Cold build passed. Profile, browser and server gates remain unverified.')
} catch (error) {
  console.error(error.message); process.exitCode = 1
} finally { console.log(`Evidence: ${join(temp, 'report.json')}`) }
