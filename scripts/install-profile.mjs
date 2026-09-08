import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
const home = process.env.DSH_HOME ?? join(homedir(), 'Library/Application Support/ORYH AI Client/harness')
const bundle = new URL('../packages/dsh-bundle', import.meta.url).pathname
const result = spawnSync('pnpm', ['exec', 'dsh', 'plugin', '--profile', 'oryh-web', 'add', bundle], { stdio: 'inherit', env: { ...process.env, DSH_HOME: home } })
if (result.status !== 0) process.exit(result.status ?? 1)
const manifestPath = join(home, 'profiles/oryh-web/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.dsh.profile.bundles = [...new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...manifest.dsh.profile.bundles])]
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`ORYH Profile installed at ${manifestPath}`)
