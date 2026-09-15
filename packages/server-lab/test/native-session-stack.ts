import { createRequire } from 'node:module'
// The real Profile is loaded by Node, so use the same module graph for all scoped services.
const nativeRequire = createRequire(import.meta.url)
const Frontend = nativeRequire('@deepseek-ai/dsh-host-frontend-static')
/** Integration fixture using real public Harness services; not a product HTTP server. */
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
const WebServer = nativeRequire('@deepseek-ai/dsh-host-webserver').default
const Connection = nativeRequire('@deepseek-ai/dsh-client-connection')
const Registry = nativeRequire('@deepseek-ai/dsh-typert-registry').default
const Defaults = nativeRequire('@deepseek-ai/dsh-agent-default-model').default
const Query = nativeRequire('@deepseek-ai/dsh-session-query').default
const Attachments = nativeRequire('@deepseek-ai/dsh-attachment-local').default
const Commands = nativeRequire('@deepseek-ai/dsh-commands').default
const Uploads = nativeRequire('@deepseek-ai/dsh-client-file-upload').default
const Controller = nativeRequire('@deepseek-ai/dsh-api-session-controller').default
const { TYPERT } = nativeRequire('@deepseek-ai/dsh-api-session-controller/typert')
const Workspace = nativeRequire('@deepseek-ai/dsh-workspace').default
const Storage = nativeRequire('@deepseek-ai/dsh-storage').default
const JsonStorage = nativeRequire('@deepseek-ai/dsh-storage-json')
const DomainStorage = nativeRequire('@deepseek-ai/dsh-storage-domain')
import { join } from 'node:path'
import ServerGateway from '../src/server-gateway.js'
import * as NativeBinding from '../src/native-binding.js'
import type { NativeOwnerAuthority } from '../src/native-binding.js'
class FixtureCredentials extends CredentialProvider {
  records = new Map<CredentialKey, CredentialRecord>()
  async resolve() { return undefined }
  async describe() { return { configured: false, writable: false } }
  async set(): Promise<void> { throw new Error('Fixture only') }
  async unset(): Promise<void> { throw new Error('Fixture only') }
  async readRecord(key: CredentialKey) { return this.records.get(key) }
  async describeRecord(key: CredentialKey) { return { configured: this.records.has(key), writable: true } }
  async listRecords() { return [] }
  async modifyRecord(key: CredentialKey, mutate: (r: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const next = await mutate(this.records.get(key)); if (next) this.records.set(key, next); else this.records.delete(key); return next
  }
  async deleteRecord(key: CredentialKey) { this.records.delete(key) }
}
export async function nativeSessionStack(ctx: Context, root: string, authority: NativeOwnerAuthority) {
  await ctx.plugin(FixtureCredentials)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Connection)
  await ctx.plugin(Registry)
  await ctx.plugin(Defaults, { provider: 'fixture', model: 'fixture' })
  await ctx.plugin(Query)
  await ctx.plugin(Attachments, { dshHome: root })
  await ctx.plugin(Commands)
  await ctx.plugin(Uploads)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(Workspace)
  ctx.provide('oryhNativeOwner', authority)
  await ctx.plugin(NativeBinding)
  await ctx.plugin(ServerGateway)
  await ctx.plugin(Controller, { nativeOpen: false })
  ctx.typert.register(TYPERT)
  await ctx.plugin(Frontend, { distIndex: createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') })
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const response = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Native test authentication failed')
  return { origin, cookie }
}
