import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(import.meta.dirname, '..')
const harness = resolve(root, '../deepseek-harness')
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const { TYPERT_REMOTE } = await import(pathToFileURL(resolve(root, 'packages/dsh-host/lib/typert.remote-client.js')).href)
const declaration = readFileSync(resolve(root, 'packages/dsh-host/lib/typert.remote-client.d.ts'), 'utf8')
const streams = new Set([...declaration.matchAll(/^\s+(\w+):.*=> AsyncIterable</gm)].map(m => m[1]))
const descriptors = TYPERT_REMOTE.descriptors.map(d => ({ namespace: d.namespace, method: d.method, invocation: d.invocation, returnShape: streams.has(d.method) ? 'stream' : 'unary' }))
console.log(JSON.stringify({
  purpose: 'P0 inventory only; no acceptance gate is automatically passed',
  client: { commit: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'branch', '--show-current'), dirty: !!git(root, 'status', '--porcelain'), lockSha256: sha(resolve(root, 'pnpm-lock.yaml')) },
  harness: { commit: git(harness, 'rev-parse', 'HEAD'), dirty: !!git(harness, 'status', '--porcelain'), lockSha256: sha(resolve(harness, 'pnpm-lock.yaml')) },
  node: process.version,
  patchSha256: sha(resolve(root, 'patches/deepseek-harness-external-remote.patch')),
  declarationSha256: sha(resolve(root, 'packages/dsh-host/lib/typert.remote-client.d.ts')),
  descriptors,
  pending: ['clean clone build', 'resolved server Profile and browser composition', 'native proxy authorization', 'OAuth credential-free skill bundle', 'trusted Chat approval', 'persistent recovery and real ORYH idempotency'],
}, null, 2))
