import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { allocateOwnerWorkspace } from '../src/owner-workspace.js'
import { nativeAdmission } from '../src/native-admission.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oryh-admission-')); roots.push(root)
  const owner = 'a'.repeat(64), workspace = await allocateOwnerWorkspace(root, owner), lifetime = new AbortController()
  const policy = nativeAdmission({ owner, workspace, workspaceId: 'bound', preset: 'server', signal: lifetime.signal,
    sessionMetadata: async id => ['mine', 'child', 'old-desktop'].includes(id) ? { cwd: workspace.path, agentPreset: id === 'old-desktop' ? 'desktop' : 'server' } : undefined })
  const admit = (namespace: string, method: string, request?: unknown) => policy.admit({ namespace, method, args: request === undefined ? {} : { request } })
  return { admit, lifetime, workspace }
}
it('binds native creation without modifying caller arguments and refuses browser-selected identities', async () => {
  const { admit, workspace } = await fixture(), request = { cwd: workspace.path }
  const result = await admit('session', 'create', request)
  expect(result.args.request).toEqual({ workspaceId: 'bound', agentPreset: 'server' })
  expect(request).toEqual({ cwd: workspace.path })
  for (const request of [{ cwd: '/tmp' }, { workspaceId: 'foreign' }, { agentPreset: 'bash' }, { sessionId: 'mine' }]) {
    await expect(admit('session', 'create', request)).rejects.toThrow()
  }
})
it('checks nested ordinary and subagent history addresses as well as command and ordering references', async () => {
  const { admit } = await fixture()
  for (const method of ['page', 'follow']) {
    await admit('session', method, { address: { kind: 'session', sessionId: 'mine' } })
    await admit('session', method, { address: { kind: 'subagent', parentSessionId: 'mine', childSessionId: 'child' } })
    for (const address of [undefined, {}, { kind: 'session', sessionId: 'foreign' },
      { kind: 'subagent', parentSessionId: 'foreign', childSessionId: 'child' },
      { kind: 'subagent', parentSessionId: 'mine', childSessionId: 'foreign' }]) {
      await expect(admit('session', method, { address })).rejects.toThrow()
    }
  }
  await expect(admit('session', 'prompt', { sessionId: 'old-desktop' })).rejects.toThrow()
  for (const method of ['prompt', 'fork', 'attachment', 'selectModel', 'cancel']) {
    await expect(admit('session', method, { sessionId: 'foreign' })).rejects.toThrow()
  }
  await expect(admit('workspace', 'insertSessionBefore', { workspaceId: 'bound', sessionId: 'mine', beforeSessionId: 'foreign' })).rejects.toThrow()
})
it('denies unlisted capability surfaces and propagates owner lifetime cancellation', async () => {
  const { admit, lifetime } = await fixture()
  for (const [namespace, method] of [['session', 'openWorkspacePath'], ['workspace', 'create'], ['workspace', 'delete'], ['shell', 'execute'], ['unknown', 'follow']]) {
    await expect(admit(namespace!, method!)).rejects.toThrow()
  }
  const stream = await admit('session', 'control')
  expect(stream.signal?.aborted).toBe(false)
  lifetime.abort()
  expect(stream.signal?.aborted).toBe(true)
  await expect(admit('session', 'list')).rejects.toThrow()
})
