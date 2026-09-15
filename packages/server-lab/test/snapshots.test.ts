import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnapshotStore, bundleHash, type Bundle } from '../src/snapshots.js'
const owner = { deployment: 'test', tenant: 'A', user: '1' }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oryh-snapshot-')); roots.push(root)
  return { root, store: new SnapshotStore(root, owner) }
}
const bundle = (text: string): Bundle => ({ owner, files: { 'timesheet/SKILL.md': text, 'timesheet/scripts/run.py': `print(${JSON.stringify(text)})` } })
it('pins complete versions while a new bundle is published, retaining the running scripts', async () => {
  const { store } = await fixture()
  const first = bundle('v1'), second = bundle('v2')
  await store.publish(first, bundleHash(first))
  const running = await store.pin()
  const pending = store.publish(second, bundleHash(second))
  const during = await store.pin()
  await pending
  const after = await store.pin()
  expect([bundleHash(first), bundleHash(second)]).toContain(during.version)
  expect(after.version).toBe(bundleHash(second))
  expect(await readFile(join(running.directory, 'timesheet/SKILL.md'), 'utf8')).toBe('v1')
  expect(await readFile(join(after.directory, 'timesheet/scripts/run.py'), 'utf8')).toBe('print("v2")')
})
it('leaves the previous version after a failed or cancelled sync', async () => {
  const { store } = await fixture()
  const first = bundle('v1')
  await store.publish(first, bundleHash(first))
  const invalid: Bundle = { owner, files: { 'skill/file': 'a', 'skill/file/child': 'b' } }
  await expect(store.publish(invalid, bundleHash(invalid))).rejects.toThrow()
  const abort = new AbortController(); abort.abort()
  await expect(store.publish(bundle('v2'), bundleHash(bundle('v2')), abort.signal)).rejects.toThrow()
  expect((await store.pin()).version).toBe(bundleHash(first))
})
it('rejects path traversal, cross-owner bundles and a mismatched manifest hash', async () => {
  const { store } = await fixture()
  for (const path of ['skill/../escape', '/etc/passwd', 'skill/.hidden', 'skill//file', 'skill\\file']) {
    expect(() => bundleHash({ owner, files: { [path]: 'x' } })).toThrow()
  }
  const other = { ...bundle('v1'), owner: { ...owner, tenant: 'B' } }
  await expect(store.publish(other, bundleHash(other))).rejects.toThrow('identity mismatch')
  await expect(store.publish(bundle('v2'), bundleHash(bundle('v1')))).rejects.toThrow('identity mismatch')
})
it('serializes publishers and snapshots input before asynchronous IO', async () => {
  const { store } = await fixture()
  const first = bundle('v1'), second = bundle('v2')
  const originalHash = bundleHash(first)
  const pending = store.publish(first, originalHash)
  Object.assign(first.files, { 'timesheet/SKILL.md': 'changed after verification' })
  const next = store.publish(second, bundleHash(second))
  const old = await pending; await next
  expect(await readFile(join(old.directory, 'timesheet/SKILL.md'), 'utf8')).toBe('v1')
  expect((await store.pin()).version).toBe(bundleHash(second))
})
