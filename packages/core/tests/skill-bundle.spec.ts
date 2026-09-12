import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { SkillBundleService, resolveEntry } from '../src/skill-bundle.js'
import type { ConnectionId } from '../src/brand.js'

const connectionId = 'c' as ConnectionId
const manifest = [{ name: 'oryh-acme-timesheet-submit', version: '3', hash: 'h3' }]

/** A stand-in for the authenticated transport; the service must never touch a credential itself. */
function http(zip: Uint8Array, entries: unknown[] = manifest) {
  const calls: string[] = []
  return {
    calls,
    client: {
      request: async (_id: ConnectionId, r: { path: string }) => { calls.push(r.path); return { data: entries } },
      download: async (_id: ConnectionId, r: { path: string }) => { calls.push(r.path); return zip },
    } as never,
  }
}

const bundle = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

describe('ORYH skill bundle', () => {
  it('installs the bundle and skips the download when the server manifest is unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oryh-skills-'))
    const transport = http(bundle({ 'oryh-acme/SKILL.md': 'hours', 'oryh-acme/scripts/oryh_request.py': 'print(1)' }))
    const service = new SkillBundleService(transport.client, root)

    const first = await service.sync(connectionId)
    expect(first.installed).toBe(true)
    expect(await readFile(join(root, 'oryh-acme/SKILL.md'), 'utf8')).toBe('hours')
    expect(await readFile(join(root, 'oryh-acme/scripts/oryh_request.py'), 'utf8')).toBe('print(1)')

    // The manifest is the whole point of the endpoint: an unchanged entitlement must not re-download.
    const second = await service.sync(connectionId)
    expect(second.installed).toBe(false)
    expect(transport.calls.filter(p => p === '/my/skill-bundle')).toHaveLength(1)

    // An explicit refresh still re-downloads, because a rotated key changes the files themselves.
    expect((await service.sync(connectionId, true)).installed).toBe(true)
  })

  it('replaces a company directory wholesale so a withdrawn skill disappears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oryh-skills-'))
    await mkdir(join(root, 'oryh-acme'), { recursive: true })
    await writeFile(join(root, 'oryh-acme/stale.md'), 'revoked by a role change')
    const service = new SkillBundleService(http(bundle({ 'oryh-acme/SKILL.md': 'fresh' })).client, root)
    await service.sync(connectionId)
    await expect(readFile(join(root, 'oryh-acme/stale.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'oryh-acme/SKILL.md'), 'utf8')).toBe('fresh')
  })

  it('lifts skills out of the company directory, because the runtime scans one level', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oryh-skills-'))
    const transport = http(bundle({
      'calwbiz-acme/README.md': 'describes the bundle, not a skill',
      'calwbiz-acme/calwbiz-acme-timesheet-submit/SKILL.md': 'hours',
      'calwbiz-acme/calwbiz-acme-timesheet-submit/scripts/oryh_request.py': 'print(1)',
      'oryh-connect/SKILL.md': 'the shared connect skill ships at the top level',
    }))
    const service = new SkillBundleService(transport.client, root)
    const result = await service.sync(connectionId)

    expect(await readFile(join(root, 'calwbiz-acme-timesheet-submit/SKILL.md'), 'utf8')).toBe('hours')
    expect(await readFile(join(root, 'calwbiz-acme-timesheet-submit/scripts/oryh_request.py'), 'utf8')).toBe('print(1)')
    expect(await readFile(join(root, 'oryh-connect/SKILL.md'), 'utf8')).toMatch(/connect skill/)
    // The company directory itself must not survive: the scanner would read it as a broken skill.
    await expect(readFile(join(root, 'calwbiz-acme/README.md'), 'utf8')).rejects.toThrow()
    expect([...result.skills].sort()).toEqual(['calwbiz-acme-timesheet-submit', 'oryh-connect'])

    // A later bundle that drops a skill must remove the directory the earlier one installed.
    const next = new SkillBundleService(http(bundle({ 'calwbiz-acme/oryh-connect/SKILL.md': 'kept' }), [{ name: 'other' }]).client, root)
    await next.sync(connectionId)
    await expect(readFile(join(root, 'calwbiz-acme-timesheet-submit/SKILL.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'oryh-connect/SKILL.md'), 'utf8')).toBe('kept')
  })

  it('withholds ORYH\'s own installer skill, because this client is the installer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oryh-skills-'))
    const service = new SkillBundleService(http(bundle({
      'calwbiz-acme/calwbiz-acme-skill-sync/SKILL.md': 'a second installer',
      'calwbiz-acme/calwbiz-acme-timesheet-submit/SKILL.md': 'hours',
    })).client, root)
    const result = await service.sync(connectionId)
    await expect(readFile(join(root, 'calwbiz-acme-skill-sync/SKILL.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'calwbiz-acme-timesheet-submit/SKILL.md'), 'utf8')).toBe('hours')
    expect(result.skills).toEqual(['calwbiz-acme-timesheet-submit'])
  })

  it('refuses an archive entry that would escape the skills directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oryh-skills-'))
    for (const name of ['../escaped.md', 'oryh-acme/../../escaped.md', '/etc/passwd', 'a\\b.md']) {
      expect(() => resolveEntry(root, name)).toThrow(/unsafe name|outside the skills directory/)
    }
    // Nothing is written when any entry is unsafe: a half-applied bundle mixes two versions.
    const service = new SkillBundleService(http(bundle({ 'oryh-acme/SKILL.md': 'ok', '../escaped.md': 'no' })).client, root)
    await expect(service.sync(connectionId)).rejects.toThrow(/unsafe name/)
    await expect(readFile(join(root, 'oryh-acme/SKILL.md'), 'utf8')).rejects.toThrow()
  })

  it('rejects an empty archive rather than wiping the installed skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oryh-skills-'))
    const service = new SkillBundleService(http(bundle({})).client, root)
    await expect(service.sync(connectionId)).rejects.toThrow(/空的/)
  })
})
