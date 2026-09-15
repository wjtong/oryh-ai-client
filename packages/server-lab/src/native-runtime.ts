/** A real, minimal Harness Host for pool verification; not the full product Profile. */
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Registry from '@deepseek-ai/dsh-typert-registry'
import * as Frontend from '@deepseek-ai/dsh-host-frontend-static'
import { createRequire } from 'node:module'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as DomainStorage from '@deepseek-ai/dsh-storage-domain'
import Session from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Workspace from '@deepseek-ai/dsh-workspace'
import { join } from 'node:path'
import { mountSessionProbe } from './session-probe.js'
import type { RunningRuntime } from './runtime-pool.js'

/** Separate synthetic records per Host; never reads environment, user home or real model keys. */
class ProbeCredentials extends CredentialProvider {
  readonly records = new Map<CredentialKey, CredentialRecord>()
  async resolve() { return undefined }
  async describe() { return { configured: false, writable: false } }
  async set(): Promise<void> { throw new Error('Probe credential writes disabled') }
  async unset(): Promise<void> { throw new Error('Probe credential writes disabled') }
  async readRecord(key: CredentialKey) { return this.records.get(key) }
  async describeRecord(key: CredentialKey) { const r = this.records.get(key); return r ? { configured: true, writable: true, kind: r.kind } : { configured: false, writable: true } }
  async listRecords() { return [...this.records].map(([key, r]) => ({ key, kind: r.kind })) }
  async modifyRecord(key: CredentialKey, mutate: (r: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const r = await mutate(this.records.get(key)); if (r) this.records.set(key, r); else this.records.delete(key); return r
  }
  async deleteRecord(key: CredentialKey) { this.records.delete(key) }
}
/** Trusted transport data only. Never serialize this value to a browser or Session. */
export interface NativeTarget { readonly port: number; readonly internalCookie: string }
export async function startNativeRuntime(owner: string, generation: number, signal: AbortSignal, ownerRoot?: string): Promise<RunningRuntime<NativeTarget>> {
  const ctx = new Context(), lifetime = new AbortController()
  let stopping: Promise<void> | undefined
  const stop = () => {
    lifetime.abort()
    return stopping ??= ctx.fiber.dispose().then(() => {})
  }
  try {
    signal.throwIfAborted()
    await ctx.plugin(ProbeCredentials)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    if (ownerRoot) {
      await ctx.plugin(Session)
      await ctx.plugin(Jsonl, { root: join(ownerRoot, 'sessions'), compression: 'none' })
      await ctx.plugin(Storage)
      await ctx.plugin(JsonStorage, { root: join(ownerRoot, 'storage') })
      await ctx.plugin(DomainStorage, { backend: 'json' })
      await ctx.plugin(Workspace)
      await ctx.workspaceRegistry.create(join(ownerRoot, 'workspace'), '我的工作区')
      // Only this assigned workspace is exposed; no browser-supplied path registration.
    }
    await ctx.plugin(Connection)
    if (ownerRoot) mountSessionProbe(ctx, join(ownerRoot, 'workspace'))
    await ctx.plugin(Registry)
    await ctx.plugin(Gateway)
    await ctx.plugin(Frontend, { distIndex: createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') })
    ctx.connection.fetch.register({ path: '/api/p0-runtime', methods: ['GET'], requestBody: 'buffered', fetch: async () => Response.json({ owner, generation }) })
    if (ownerRoot) ctx.connection.fetch.register({ path: '/api/p0-workspace', methods: ['GET'], requestBody: 'buffered', fetch: async () => {
      const workspace = await ctx.workspaceRegistry.create(join(ownerRoot, 'workspace'), '我的工作区')
      return Response.json({ id: workspace.id, title: workspace.title, createdAt: workspace.createdAt })
    } })
    const origin = `http://127.0.0.1:${ctx.webServer.port}`
    const response = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual', signal })
    const internalCookie = response.headers.get('set-cookie')?.split(';')[0]
    if (response.status !== 303 || !internalCookie) throw new Error('Private Harness authentication failed')
    signal.throwIfAborted()
    return { value: Object.freeze({ port: ctx.webServer.port, internalCookie }), signal: lifetime.signal, stop }
  } catch {
    await stop()
    throw new Error('Native runtime startup failed')
  }
}
