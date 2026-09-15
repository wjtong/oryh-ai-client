import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '@deepseek-ai/dsh-bash-local'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
const exec = promisify(execFile)

/**
 * Public ShellExecutor provider experiment. Harness remains on the trusted side; only the
 * command runs in Docker. Reuses public LocalBashExecutor deadline/output/subprocess mechanics.
 * No daemon socket, Host HOME, credentials or plugin code is mounted in the execution container.
 */
export async function containerShellProvider(workspace: string, image: string, uid: number, gid: number): Promise<typeof LocalBashExecutor & { readonly probeLabel: string }> {
  if (!isAbsolute(workspace) || !/^sha256:[a-f0-9]{64}$/.test(image) || !Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0) throw new Error('Invalid trusted container configuration')
  const root = await realpath(workspace)
  if (root.includes(',')) throw new Error('Unsupported mount path')
  const label = `oryh-shell-p0-${randomUUID()}`
  const names = new Set<string>()
  async function docker(args: string[]) { return (await exec('docker', args, { timeout: 30_000, maxBuffer: 128_000 })).stdout }
  async function remove(name: string) {
    try { await docker(['rm', '-f', name]); names.delete(name) }
    catch {
      // A failed create may never have registered the name; verify absence instead of hiding
      // cleanup failures. No arbitrary container IDs or user-owned resources are accepted.
      const remaining = await docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])
      if (remaining.trim()) throw new Error('P0 execution container cleanup failed')
      names.delete(name)
    }
  }
  return class ContainerShell extends LocalBashExecutor {
    static readonly probeLabel = label
    constructor(ctx: Context, config: Config) {
      super(ctx, config)
      ctx.effect(() => async () => { for (const name of names) await remove(name) }, 'P0 container cleanup')
    }
    override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
      const aborted = (): ShellRunResult => ({ exitCode: null, signal: null, timedOut: false, aborted: true, timeoutMs: spec.timeoutMs, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } })
      if (spec.signal?.aborted) return aborted()
      if (!isAbsolute(spec.workdir)) throw new Error('Working directory outside assigned workspace')
      const target = await realpath(spec.workdir)
      const sub = relative(root, target)
      if (!isAbsolute(spec.workdir) || sub === '..' || sub.startsWith(`..${sep}`) || isAbsolute(sub)) throw new Error('Working directory outside assigned workspace')
      if (spec.sandboxPolicy !== undefined || Object.keys(spec.env ?? {}).length || Object.keys(spec.dshEnv ?? {}).length) throw new Error('P0 provider does not yet support per-call policies or environment forwarding')
      if (spec.command.length > 256_000 || spec.stdoutMaxBytes > 1_048_576) throw new Error('P0 execution request exceeds limits')
      spec.signal?.throwIfAborted()
      const name = `${label}-${randomUUID().slice(0, 8)}`
      names.add(name)
      try {
        await docker(['create', '--pull', 'never', '--name', name, '--label', `oryh.shell-p0=${label}`,
          '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--user', `${uid}:${gid}`, '--memory', '128m', '--pids-limit', '64', '--cpus', '0.5',
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,src=${root},dst=/workspace`,
          '--workdir', sub ? `/workspace/${sub.split(sep).join('/')}` : '/workspace',
          ...(spec.stdin === undefined ? [] : ['-i']), image, 'bash', '-c', spec.command])
        // A cancellation during create is observed before start. Cleanup waits for the create
        // response, avoiding the normal daemon-start/client-kill race in `docker run`.
        spec.signal?.throwIfAborted()
        return await this.runArgv({ ...spec, workdir: root }, ['docker', 'start', '-a', ...(spec.stdin === undefined ? [] : ['-i']), name])
      } catch (error) {
        if (spec.signal?.aborted) return aborted()
        throw error
      } finally { await remove(name) }
    }
    override start(_spec: ShellExecSpec): ShellProcess {
      let unread = true
      return { status: 'killed', exitCode: null, signal: null, done: Promise.resolve(), kill: () => false,
        readOutput() { const delta = unread ? '[stderr]\nP0 container provider: background execution is not enabled.' : ''; unread = false; return { delta, lossy: false } } }
    }
  }
}
