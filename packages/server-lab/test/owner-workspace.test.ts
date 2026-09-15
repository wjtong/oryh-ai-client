import { mkdtemp, rm, symlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { allocateOwnerWorkspace, requireOwnerWorkspace } from '../src/owner-workspace.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function root() { const p = await mkdtemp(join(tmpdir(), 'oryh-workspace-')); roots.push(p); return p }
const a = 'a'.repeat(64), b = 'b'.repeat(64)
it('allocates stable separate directories and admits only the original owner capability', async () => {
  const r = await root(), one = await allocateOwnerWorkspace(r,a), two = await allocateOwnerWorkspace(r,b)
  expect(await requireOwnerWorkspace(one,a)).toBe(one.path)
  expect(two.path).not.toBe(one.path)
  expect((await allocateOwnerWorkspace(r,a)).path).toBe(one.path)
  await expect(requireOwnerWorkspace(one,b)).rejects.toThrow()
  await expect(requireOwnerWorkspace({...one},a)).rejects.toThrow()
  await expect(requireOwnerWorkspace(JSON.parse(JSON.stringify(one)),a)).rejects.toThrow()
})
it('rejects symlink replacement on subsequent admission', async () => {
  const r = await root(), one = await allocateOwnerWorkspace(r,a), two = await allocateOwnerWorkspace(r,b)
  await rm(one.path, { recursive: true }); await symlink(two.path, one.path)
  await expect(requireOwnerWorkspace(one,a)).rejects.toThrow()
  await expect(allocateOwnerWorkspace(r,a)).rejects.toThrow()
})
it('rejects unallocated identities and shared or symlinked roots', async () => {
  const r = await root()
  await expect(allocateOwnerWorkspace(r,'../outside')).rejects.toThrow()
  await chmod(r,0o755)
  await expect(allocateOwnerWorkspace(r,a)).rejects.toThrow()
  await chmod(r,0o700)
  const outer = await root(), link = join(outer,'link'); await symlink(r,link)
  await expect(allocateOwnerWorkspace(link,a)).rejects.toThrow()
})
