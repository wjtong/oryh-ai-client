// Opt-in P0 lab. Creates only randomly named, labelled containers and volumes; cleans its own.
// No real ORYH endpoint, credentials, user directory, or Docker socket is mounted inside them.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
await access(resolve(root, 'lib/broker.js'))
const docker = async (...args) => (await exec('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024 })).stdout.trim()
// Resolve the installed image to an immutable local content ID; never silently pull latest.
const image = await docker('image', 'inspect', process.env.ORYH_P0_IMAGE ?? 'node:24-bookworm-slim', '--format', '{{.Id}}')
const prefix = `oryh-p0-${randomUUID().slice(0, 8)}`
const names = ['A1', 'A2', 'B1', 'B3']
const volumes = []
const containers = []
const brokerName = `${prefix}-broker`
const limits = ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '128m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--label', `oryh.p0=${prefix}`]
let cleaning
const cleanup = () => cleaning ??= (async () => {
  const failures = []
  for (const name of containers.reverse()) { try { await docker('rm', '-f', name) } catch { failures.push(name) } }
  for (const name of volumes.reverse()) { try { await docker('volume', 'rm', name) } catch { failures.push(name) } }
  if (failures.length) console.error(`Manual cleanup needed for lab resources: ${failures.join(', ')}`)
})()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(1)) })
try {
  for (const name of names) { const volume = `${prefix}-${name}`; await docker('volume', 'create', '--label', `oryh.p0=${prefix}`, volume); volumes.push(volume) }
  containers.push(brokerName)
  await docker('run', '-d', '--name', brokerName, ...limits,
    '--mount', `type=bind,src=${root},dst=/lab,readonly`,
    ...volumes.flatMap((volume, i) => ['--mount', `type=volume,src=${volume},dst=/channels/${names[i]}`]),
    image, 'node', '/lab/docker/broker.mjs')
  async function waitLog(marker) {
    for (let i = 0; i < 50; i++) {
      if ((await docker('logs', brokerName)).includes(marker)) return
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`Lab broker did not emit ${marker}`)
  }
  await waitLog('READY')
  for (const name of names) {
    const container = `${prefix}-exec-${name}`
    containers.push(container)
    const volume = volumes[names.indexOf(name)]
    await docker('run', '-d', '--name', container, ...limits, '--user', '1000:1000',
      '--mount', `type=bind,src=${root},dst=/lab,readonly`,
      '--mount', `type=volume,src=${volume},dst=/channel,readonly`,
      image, 'node', '-e', 'setInterval(() => {}, 10000)')
  }
  const results = await Promise.all(names.map(async name => ({ owner: name,
    checks: JSON.parse(await docker('exec', `${prefix}-exec-${name}`, 'node', '/lab/docker/runner.mjs')) })))
  await docker('kill', '--signal', 'USR1', brokerName); await waitLog('ADVANCED')
  const old = JSON.parse(await docker('exec', `${prefix}-exec-A1`, 'node', '/lab/docker/runner.mjs', 'denied'))
  await docker('kill', '--signal', 'USR2', brokerName); await waitLog('REVOKED')
  const revoked = JSON.parse(await docker('exec', `${prefix}-exec-A2`, 'node', '/lab/docker/runner.mjs', 'denied'))
  console.log(JSON.stringify({ phase: 'P0 synthetic boundary probe only', image, results, old, revoked,
    unverified: ['Harness runtime composition', 'real OAuth/bundle/ORYH writes', 'trusted browser approval', 'durability', 'capacity under load'] }, null, 2))
} finally { await cleanup() }
