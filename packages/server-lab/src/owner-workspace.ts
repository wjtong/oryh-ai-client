/** Non-serializable authority for a server-allocated owner workspace. */
import { mkdir, lstat, realpath } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
export interface OwnerWorkspace { readonly path: string }
interface Bound { root: string; owner: string; path: string }
const bindings = new WeakMap<OwnerWorkspace, Bound>()
const deny = () => new Error('Trusted owner workspace unavailable')
async function directory(path: string, create: boolean) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  const s = await lstat(path)
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 || (process.getuid && s.uid !== process.getuid())) throw deny()
}
/** Root is a pre-created, private server data directory, never a browser path. */
export async function allocateOwnerWorkspace(root: string, owner: string): Promise<OwnerWorkspace> {
  if (!isAbsolute(root) || !/^[a-f0-9]{64}$/.test(owner)) throw deny()
  await directory(root, false)
  const canonical = await realpath(root)
  const home = join(canonical, owner), path = join(home, 'workspace')
  await directory(home, true); await directory(path, true)
  const handle = Object.freeze({ path })
  bindings.set(handle, { root: canonical, owner, path })
  return handle
}
/** Revalidate on each admission: serialized/copied handles and changed filesystem roots fail closed. */
export async function requireOwnerWorkspace(handle: OwnerWorkspace, owner: string): Promise<string> {
  const bound = bindings.get(handle)
  if (!bound || bound.owner !== owner) throw deny()
  await directory(bound.root, false)
  await directory(join(bound.root, owner), false)
  await directory(bound.path, false)
  if (await realpath(bound.path) !== bound.path) throw deny()
  return bound.path
}
