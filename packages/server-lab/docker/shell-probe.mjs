// Opt-in real public ShellExecutor + local subprocess integration. Synthetic workspace only.
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { containerShellProvider } from '../lib/container-shell.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const exec = promisify(execFile)
const image = (await exec('docker', ['image', 'inspect', process.env.ORYH_P0_IMAGE ?? 'node:24-bookworm-slim', '--format', '{{.Id}}'])).stdout.trim()
const temp = await mkdtemp(join(tmpdir(), 'oryh-shell-p0-'))
const workspace = join(temp, 'workspace')
await mkdir(workspace); await mkdir(join(workspace, 'sub'))
await writeFile(join(temp, 'host-only.txt'), 'SYNTHETIC-HOST-PRIVATE')
const ctx = new Context()
try {
  await ctx.plugin(LocalSubprocess)
  const Provider = await containerShellProvider(workspace, image, process.getuid?.() || 1000, process.getgid?.() ?? 1000)
  await ctx.plugin(Provider, { cwd: workspace, timeoutMs: 10000, maxTimeoutMs: 10000, maxOutputBytes: 4096, maxSpillBytes: 65536, graceMs: 100 })
  const run = request => ctx.shell.run(ctx.shell.resolve(request))
  const result = await run({ command: 'set -e; printf content > saved.txt; test ! -e /var/run/docker.sock; test ! -e /workspace/../host-only.txt; test ! -e /lab; printf "%s" "$PWD"' })
  assert.equal(result.exitCode, 0); assert.equal(result.stdout.text, '/workspace')
  assert.equal(await readFile(join(workspace, 'saved.txt'), 'utf8'), 'content')
  const nested = await run({ command: 'pwd', workdir: join(workspace, 'sub') })
  assert.equal(nested.stdout.text.trim(), '/workspace/sub')
  await assert.rejects(run({ command: 'pwd', workdir: temp }), /outside assigned workspace/)
  await assert.rejects(run({ command: 'env', env: { SYNTHETIC_SECRET: 'do-not-forward' } }), /environment forwarding/)
  const failed = await run({ command: 'exit 7' }); assert.equal(failed.exitCode, 7)
  const stdin = await run({ command: 'cat', stdin: 'stdin-probe' }); assert.equal(stdin.stdout.text, 'stdin-probe')
  const timeout = await run({ command: 'sleep 60 & wait', timeoutMs: 700 })
  assert.equal(timeout.timedOut, true)
  const preAborted = new AbortController(); preAborted.abort()
  const neverStarted = await run({ command: 'touch must-not-exist', signal: preAborted.signal })
  assert.equal(neverStarted.aborted, true)
  await assert.rejects(readFile(join(workspace, 'must-not-exist')))
  const abort = new AbortController()
  const pending = run({ command: 'sleep 60 & wait', signal: abort.signal })
  setTimeout(() => abort.abort(), 1500)
  const cancelled = await pending
  assert.equal(cancelled.aborted, true)
  const remaining = (await exec('docker', ['ps', '-a', '--filter', `label=oryh.shell-p0=${Provider.probeLabel}`, '--format', '{{.Names}}'])).stdout.trim()
  assert.equal(remaining, '', 'Timed out/aborted execution containers must be removed')
  const bg = ctx.shell.start(ctx.shell.resolve({ command: 'sleep 60' }))
  await bg.done; assert.equal(bg.status, 'killed')
  assert.match(bg.readOutput().delta, /not enabled/); assert.equal(bg.readOutput().delta, '')
  console.log(JSON.stringify({ publicProvider: 'ShellExecutor via LocalBashExecutor', image,
    passed: ['real Cordis service registration', 'container workspace write', 'Host files not mounted', 'cwd confinement', 'no environment forwarding', 'exit code and stdin', 'foreground timeout with child process', 'foreground abort cleanup', 'pre-aborted request never starts'],
    limitations: ['No full Agent/preset integration', 'Background mode intentionally disabled', 'No managed DSH environment/policy adapter', 'Daemon loss/orphan reconciliation pending', 'No real business or model credentials'] }, null, 2))
} finally { await ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
