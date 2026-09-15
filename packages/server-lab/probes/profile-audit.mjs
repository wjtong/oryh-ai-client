// Read-only public Profile composition audit. Does not boot plugins or read a user's Profile.
import { initProfile, loadProfileDirectory, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const require = createRequire(import.meta.url)
const rootRequire = createRequire(new URL('../../../package.json', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'oryh-profile-audit-'))
try {
  initProfile(dir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@oryh/dsh-bundle'], 'startup')
  await mkdir(join(dir, 'node_modules/@oryh'), { recursive: true })
  await symlink(dirname(require.resolve('@oryh/dsh-bundle/cordis.patch.yml')), join(dir, 'node_modules/@oryh/dsh-bundle'))
  const profile = loadProfileDirectory('oryh-p0-audit', dir, rootRequire.resolve('@deepseek-ai/dsh/package.json'), { userLayer: false })
  const warnings = []
  const entries = composeEntries(profile.layers.map(layer => layer.patches), warning => warnings.push(warning))
  const rows = []
  function collect(items, prefix = '') {
    for (const entry of items) {
      rows.push({ id: `${prefix}${entry.id ?? ''}`, name: entry.name ?? '', disabled: entry.disabled === true })
      if (Array.isArray(entry.config)) collect(entry.config, `${prefix}${entry.id}/`)
    }
  }
  collect(entries)
  const report = { kind: 'desktop-profile-source-audit', layers: profile.layers.map(layer => layer.packageName), patchReload: profile.patchReload,
    warnings, rows, caveats: ['No plugin activation or browser composition', 'Config values and user layers are omitted', 'Agent preset runtime additions are not enumerated by this static tree'] }
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(JSON.stringify({ layers: report.layers, rows: rows.length, warnings: warnings.length }) + '\n')
} finally { await rm(dir, { recursive: true, force: true }) }
