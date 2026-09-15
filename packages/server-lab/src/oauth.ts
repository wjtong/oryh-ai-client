import type { Context } from '@deepseek-ai/cordis'
import { mountServerSkills } from './server-skills.js'
import type { SkillEvidence } from './mcp-skills.js'
/** P0 server login coordinator. No HTTP routes or browser credential delivery. */
import { createHash, randomBytes } from 'node:crypto'
import { credentialKey, type CredentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { createServerReadHost, assertServerRead, decodeIdentity, type OryhIdentity } from '@oryh/ai-client-core'
import { connectSkillReader } from './mcp-reader.js'

type Records = Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>
export interface LoginGrant { readonly owner: string; readonly identity: OryhIdentity }
interface Pending { binding: string; verifier: string; expires: number; signal: AbortSignal }
interface GrantState {
  key: CredentialKey; active: boolean; abort: AbortController; identity: string
  queue: Promise<unknown>; refresh?: Promise<string>; revocation?: Promise<void>
}
interface Pair { access: string; refresh: string; expires: number }
const random = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const failure = () => new Error('ORYH authorization unavailable; sign in again.')

export class ServerOAuth {
  private readonly pending = new Map<string, Pending>()
  private readonly grants = new WeakMap<LoginGrant, GrantState>()
  private readonly issuer: string
  private readonly clientId: string
  private readonly callback: string
  private readonly now: () => number
  constructor(private readonly options: {
    issuer: string; clientId: string; callback: string; credentials: Records
    fetch?: typeof fetch; now?: () => number; allowLoopbackForTest?: boolean
  }) {
    this.issuer = this.url(options.issuer).origin
    if (options.issuer.replace(/\/$/, '') !== this.issuer) throw new Error('Issuer must be an origin')
    this.clientId = this.url(options.clientId).href
    this.callback = this.url(options.callback).href
    if (new URL(this.clientId).origin !== new URL(this.callback).origin) throw new Error('Callback must share the client origin')
    this.now = options.now ?? Date.now
  }
  /** Canonical server origin; safe for connection selectors, never a credential. */
  get serverOrigin(): string { return this.issuer }
  /** Public metadata only; no grant or credential is included. */
  browserMetadata() { return { clientId: this.clientId, callback: this.callback } }
  private url(value: string): URL {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' &&
      !(this.options.allowLoopbackForTest && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Invalid trusted OAuth URL')
    return url
  }
  /** binding is a random pre-login cookie owned by the trusted HTTP entry, never model input. */
  begin(binding: string, signal: AbortSignal): { authorizationUrl: string } {
    signal.throwIfAborted()
    if (binding.length < 32) throw new Error('Pre-login browser binding required')
    for (const [id, p] of this.pending) if (p.expires <= this.now() || p.signal.aborted) this.pending.delete(id)
    if (this.pending.size >= 1000) throw new Error('Too many pending logins')
    const state = random(), verifier = random()
    this.pending.set(hash(state), { binding: hash(binding), verifier, expires: this.now() + 600_000, signal })
    const url = new URL('/oauth/authorize', this.issuer)
    url.search = new URLSearchParams({
      response_type: 'code', client_id: this.clientId, redirect_uri: this.callback,
      state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', resource: `${this.issuer}/mcp`,
    }).toString()
    return { authorizationUrl: url.href }
  }
  /** The trusted route passes individual, duplicate-checked callback parameters. No redirect from request input. */
  async complete(input: { state: string; code?: string; error?: string; binding: string }): Promise<LoginGrant> {
    const key = hash(input.state), pending = this.pending.get(key)
    if (!pending || pending.binding !== hash(input.binding)) throw failure()
    // Spend before the first await: concurrent callbacks cannot exchange the same code twice.
    this.pending.delete(key)
    if (pending.expires <= this.now() || pending.signal.aborted || input.error || !input.code) throw failure()
    const abort = new AbortController()
    const signal = AbortSignal.any([pending.signal, abort.signal])
    const recordKey = credentialKey('oryh-server', `grant-${hash(random())}`)
    try {
      const pair = this.pair(await this.request('/oauth/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code,
          code_verifier: pending.verifier, client_id: this.clientId, redirect_uri: this.callback, resource: `${this.issuer}/mcp` }),
      }, signal))
      const identity = await this.identity(pair.access, signal)
      const owner = this.owner(identity)
      // Decode from ORYH; no tenant/user from the callback participates in this value.
      const grant: LoginGrant = Object.freeze({ owner, identity: Object.freeze({
        ...identity, user: Object.freeze(identity.user), tenant: Object.freeze(identity.tenant), permissions: Object.freeze([...(identity.permissions ?? [])]),
      }) })
      const state: GrantState = { key: recordKey, active: true, abort, identity: owner, queue: Promise.resolve() }
      await this.options.credentials.modifyRecord(recordKey, async () => {
        signal.throwIfAborted(); return { kind: 'grant', payload: pair }
      })
      signal.throwIfAborted()
      this.grants.set(grant, state)
      return grant
    } catch {
      abort.abort(); await this.options.credentials.deleteRecord(recordKey).catch(() => {})
      throw failure()
    }
  }
  /** Trusted-only callback for MCP transport. Never register this method as a Remote or model tool. */
  async accessToken(grant: LoginGrant): Promise<string> {
    const state = this.state(grant)
    if (state.refresh) return state.refresh
    const read = async () => {
      try {
        const stored = await this.options.credentials.readRecord(state.key)
        this.state(grant)
        const p = stored?.kind === 'grant' ? stored.payload as unknown as Pair : undefined
        if (!p || typeof p.access !== 'string' || typeof p.refresh !== 'string' || !Number.isFinite(p.expires)) throw failure()
        if (p.expires > this.now() + 30_000) return p.access
        const rotated = this.pair(await this.request('/oauth/token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: p.refresh, client_id: this.clientId, resource: `${this.issuer}/mcp` }),
        }, state.abort.signal))
        if (this.owner(await this.identity(rotated.access, state.abort.signal)) !== state.identity) throw failure()
        await this.serial(state, async () => {
          this.state(grant)
          await this.options.credentials.modifyRecord(state.key, async () => {
            this.state(grant); return { kind: 'grant', payload: rotated }
          })
        })
        this.state(grant)
        return rotated.access
      } catch {
        // Ambiguous refresh can already have rotated the server token; never retry it blindly.
        await this.revoke(grant).catch(() => {})
        throw failure()
      }
    }
    const refreshing = read()
    state.refresh = refreshing
    try { return await refreshing } finally { delete state.refresh }
  }
  createReadHost(grant: LoginGrant): ReturnType<typeof createServerReadHost> {
    return createServerReadHost({ origin: this.issuer, identity: grant.identity, signal: this.signal(grant),
      request: async (request, signal) => {
        assertServerRead(request)
        const access = await this.accessToken(grant)
        return this.request(`/api/v1${request.path}`, { headers: { authorization: `Bearer ${access}` } }, signal)
      } })
  }
  /** Per-login runtime only; not the shared owner process or browser configuration. */
  async createReadRuntime(grant: LoginGrant) {
    const host = await this.createReadHost(grant)
    const [connection] = await host.connections()
    if (!connection) throw failure()
    const principal = { origin: this.issuer, tenantId: grant.identity.tenant.id, userId: grant.identity.user.id,
      employeeId: grant.identity.user.employeeId, tenantName: grant.identity.tenant.name ?? grant.identity.tenant.slug, email: grant.identity.user.email }
    return { host, mountSkills: async (ctx: Context, record: (e: SkillEvidence) => void) => {
      const mcp = await this.connectSkills(grant)
      try {
        const mounted = mountServerSkills(ctx, { connectionId: connection.id, principal, signal: this.signal(grant), reader: mcp.reader, record })
        ctx.effect(() => () => mcp.close(), 'oryh MCP transport')
        return mounted
      } catch (error) { await mcp.close(); throw error }
    } }
  }
  connectSkills(grant: LoginGrant): ReturnType<typeof connectSkillReader> {
    return connectSkillReader({ endpoint: `${this.issuer}/mcp`, accessToken: () => this.accessToken(grant),
      signal: this.signal(grant), ...(this.options.allowLoopbackForTest ? { allowLoopbackForTest: true } : {}) })
  }
  signal(grant: LoginGrant): AbortSignal { return this.state(grant).abort.signal }
  /** End local use immediately and revoke the interactive pair at the pinned ORYH issuer. */
  async revoke(grant: LoginGrant): Promise<void> {
    const state = this.grants.get(grant)
    if (!state) throw failure()
    if (state.revocation) return state.revocation
    state.active = false; state.abort.abort()
    state.revocation = this.serial(state, async () => {
      const stored = await this.options.credentials.readRecord(state.key)
      try {
        const pair = stored?.kind === 'grant' ? stored.payload as unknown as Pair : undefined
        if (!pair) return
        const response = await (this.options.fetch ?? fetch)(`${this.issuer}/oauth/revoke`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: pair.refresh, token_type_hint: 'refresh_token' }),
        })
        if (!response.ok) throw failure()
      } catch { throw failure() }
      finally { await this.options.credentials.deleteRecord(state.key) }
    })
    return state.revocation
  }
  private state(grant: LoginGrant): GrantState {
    const state = this.grants.get(grant)
    if (!state?.active) throw failure()
    return state
  }
  private async serial<T>(state: GrantState, run: () => Promise<T>): Promise<T> {
    const next = state.queue.then(run, run)
    state.queue = next.catch(() => {})
    return next
  }
  private owner(identity: OryhIdentity): string {
    if (!identity.tenant.id.trim() || !identity.user.id.trim()) throw failure()
    return hash(JSON.stringify([this.issuer, identity.tenant.id, identity.user.id]))
  }
  private identity(token: string, signal: AbortSignal): Promise<OryhIdentity> {
    return this.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } }, signal).then(decodeIdentity)
  }
  private pair(value: unknown): Pair {
    const p = value as Record<string, unknown> | null
    if (!p || p.token_type !== 'Bearer' || typeof p.access_token !== 'string' || !p.access_token ||
      typeof p.refresh_token !== 'string' || !p.refresh_token || typeof p.expires_in !== 'number' ||
      !Number.isFinite(p.expires_in) || p.expires_in <= 0 || p.expires_in > 31_536_000) throw failure()
    return { access: p.access_token, refresh: p.refresh_token, expires: this.now() + p.expires_in * 1000 }
  }
  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    try {
      signal.throwIfAborted()
      const response = await (this.options.fetch ?? fetch)(`${this.issuer}${path}`, { ...init, redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
      if (!response.ok) throw failure()
      const body: unknown = await response.json()
      signal.throwIfAborted()
      return body
    } catch { throw failure() }
  }
}
