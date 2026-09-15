import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { ownerKey, type Owner } from './broker.js'

export interface Bundle {
  readonly owner: Owner
  readonly files: Readonly<Record<string, string>>
}
export interface Snapshot { readonly owner: Owner; readonly version: string; readonly directory: string }
function entries(bundle: Bundle): [string, string][] {
  const files = Object.entries(bundle.files).sort(([a], [b]) => a.localeCompare(b, 'en'))
  if (!files.length || files.length > 2000) throw new Error('Invalid bundle size')
  let size = 0
  for (const [path, content] of files) {
    if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))
      || typeof content !== 'string') throw new Error('Invalid bundle path or content')
    size += Buffer.byteLength(content)
    if (size > 8 * 1024 * 1024) throw new Error('Bundle too large')
  }
  return files
}
/** Content identity only; expected hash must come from a trusted, authenticated bundle contract. */
export function bundleHash(bundle: Bundle): string {
  return createHash('sha256').update(JSON.stringify([ownerKey(bundle.owner), entries(bundle)])).digest('hex')
}

/**
 * P0 atomic publication experiment. Root must be a trusted directory, unmounted in execution
 * containers. A production sync service must serialize publishers across processes and provide
 * authenticated manifests. This class intentionally does not garbage-collect pinned versions.
 */
export class SnapshotStore {
  #tail: Promise<unknown> = Promise.resolve()
  readonly #owner: Owner
  readonly #root: string
  constructor(root: string, owner: Owner) {
    if (!isAbsolute(root)) throw new Error('Snapshot root must be absolute')
    this.#owner = Object.freeze({ ...owner })
    this.#root = join(root, createHash('sha256').update(ownerKey(owner)).digest('hex'))
  }
  publish(bundle: Bundle, expectedHash: string, signal?: AbortSignal): Promise<Snapshot> {
    // Copy/validate before yielding; caller mutation cannot change already verified content.
    const copy: Bundle = { owner: { ...bundle.owner }, files: Object.fromEntries(entries(bundle)) }
    if (ownerKey(copy.owner) !== ownerKey(this.#owner) || bundleHash(copy) !== expectedHash) return Promise.reject(new Error('Bundle identity mismatch'))
    const result = this.#tail.then(() => this.install(copy, expectedHash, signal))
    this.#tail = result.catch(() => undefined)
    return result
  }
  private async install(bundle: Bundle, hash: string, signal?: AbortSignal): Promise<Snapshot> {
    signal?.throwIfAborted()
    const versions = join(this.#root, 'versions')
    await mkdir(versions, { recursive: true, mode: 0o700 })
    const directory = join(versions, `${hash}-${randomUUID()}`)
    const pointer = join(this.#root, `next-${randomUUID()}`)
    let published = false
    try {
      await mkdir(directory, { mode: 0o700 })
      for (const [path, content] of entries(bundle)) {
        signal?.throwIfAborted()
        const parts = path.split('/')
        await mkdir(join(directory, ...parts.slice(0, -1)), { recursive: true, mode: 0o700 })
        await writeFile(join(directory, path), content, { flag: 'wx', mode: 0o400 })
      }
      await writeFile(pointer, JSON.stringify({ hash, name: directory.split('/').at(-1) }), { flag: 'wx', mode: 0o600 })
      signal?.throwIfAborted()
      // Readers see either the old complete version or the new complete version.
      await rename(pointer, join(this.#root, 'current.json'))
      published = true
      return { owner: this.#owner, version: hash, directory }
    } finally {
      await rm(pointer, { force: true })
      if (!published) await rm(directory, { recursive: true, force: true })
    }
  }
  async pin(): Promise<Snapshot> {
    const { hash, name } = JSON.parse(await readFile(join(this.#root, 'current.json'), 'utf8')) as { hash: string; name: string }
    if (!/^[a-f0-9]{64}$/.test(hash) || typeof name !== 'string' || !name.startsWith(`${hash}-`) || !/^[a-f0-9-]+$/.test(name)) throw new Error('Invalid snapshot pointer')
    return { owner: this.#owner, version: hash, directory: join(this.#root, 'versions', name) }
  }
}
