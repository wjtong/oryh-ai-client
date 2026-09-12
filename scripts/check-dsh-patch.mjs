import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
// The external-plugin Remote fix is not upstream yet. A DSH sync drops it silently, and the
// generator then skips this plugin's decorated methods instead of failing, so the check is loud here.
const marker = 'External plugins resolve protocol declarations through the public package export.'
const generator = dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-typert-generator/package.json'))
const analyzer = resolve(generator, 'src/analyzer.ts')
if (!readFileSync(analyzer, 'utf8').includes(marker)) {
  console.error(`ORYH Remote generation needs the external-plugin protocol fix, absent from ${analyzer}.`)
  console.error('Re-apply it, then rebuild DSH:')
  console.error(`  git -C ${resolve(generator, '../../..')} apply ${resolve(import.meta.dirname, '../patches/deepseek-harness-external-remote.patch')}`)
  process.exit(1)
}
