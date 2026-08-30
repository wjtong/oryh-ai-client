import type { ConnectionId } from './brand.js'
import type { CredentialPair, CredentialVault } from './credentials.js'
import { OryhClientError } from './errors.js'
import type { ConnectionRegistry } from './connections.js'

/** A minimal fetch response seam, small enough to replace in tests or DSH Host adapters. */
export interface FetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** A minimal fetch seam, injected by the Host rather than read globally. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<FetchResponse>

/** A request constrained to ORYH's versioned API paths. */
export interface OryhRequest {
  readonly path: `/${string}`
  readonly method?: 'GET' | 'POST'
  readonly body?: unknown
}

/** Host-local timings that govern when an interactive credential is refreshed. */
export interface OryhHttpClientOptions {
  /** Clock used for the expiry check; injectable so the decision has deterministic coverage. */
  readonly clock?: () => Date
  /** Refresh an access key this many milliseconds before its server-provided expiry. */
  readonly refreshAheadMs?: number
}

interface ErrorBody {
  readonly detail?: unknown
}

function apiPath(origin: string, path: string): string {
  return `${origin}/api/v1${path}`
}

function errorDetail(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const detail = (value as ErrorBody).detail
  return typeof detail === 'string' ? detail : undefined
}

function expiredKey(response: FetchResponse, body: unknown): boolean {
  return response.status === 401 && errorDetail(body)?.includes('API key expired') === true
}

function asCredential(value: unknown): CredentialPair {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OryhClientError('ORYH returned an invalid refresh response.', 'invalid-response')
  }
  const data = (value as { data?: unknown }).data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new OryhClientError('ORYH returned an invalid refresh response.', 'invalid-response')
  }
  const fields = data as Record<string, unknown>
  if (typeof fields.api_key !== 'string' || typeof fields.refresh_token !== 'string') {
    throw new OryhClientError('ORYH returned an invalid refresh response.', 'invalid-response')
  }
  const expiresAt = fields.expires_at
  if (expiresAt !== null && expiresAt !== undefined && typeof expiresAt !== 'string') {
    throw new OryhClientError('ORYH returned an invalid refresh response.', 'invalid-response')
  }
  const credential = {
    accessKey: fields.api_key,
    refreshToken: fields.refresh_token,
    expiresAt: expiresAt ?? null,
  }
  if (credential.expiresAt !== null && !Number.isFinite(Date.parse(credential.expiresAt))) {
    throw new OryhClientError('ORYH returned an invalid refresh response.', 'invalid-response')
  }
  return credential
}

const DEFAULT_REFRESH_AHEAD_MS = 60_000

/** Host-only HTTP adapter that injects credentials, refreshes once, and never returns them. */
export class OryhHttpClient {
  readonly #clock: () => Date
  readonly #refreshAheadMs: number
  readonly #refreshes = new Map<ConnectionId, Promise<CredentialPair>>()

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly credentials: CredentialVault,
    private readonly fetcher: Fetcher,
    options: OryhHttpClientOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#refreshAheadMs = refreshAheadMs(options.refreshAheadMs)
  }

  /** Call a versioned ORYH API endpoint inside one existing connection scope. */
  async request(connectionId: ConnectionId, request: OryhRequest): Promise<unknown> {
    const connection = this.connections.require(connectionId)
    let credential = await this.requireCredential(connectionId)
    if (shouldRefresh(credential, this.#clock(), this.#refreshAheadMs)) {
      credential = await this.refreshCredential(connectionId, connection.origin, credential)
    }
    const first = await this.send(connection.origin, request, credential.accessKey)
    const firstBody = await first.json()
    if (first.ok) return firstBody
    if (!expiredKey(first, firstBody)) throw requestError(first, firstBody)

    const refreshed = await this.refreshCredential(connectionId, connection.origin, credential)
    const second = await this.send(connection.origin, request, refreshed.accessKey)
    const secondBody = await second.json()
    if (second.ok) return secondBody
    throw requestError(second, secondBody)
  }

  /** Read one whole credential bundle or fail before a request exposes an absent connection. */
  private async requireCredential(connectionId: ConnectionId): Promise<CredentialPair> {
    const credential = await this.credentials.read(connectionId)
    if (credential === undefined) {
      throw new OryhClientError('The ORYH connection has no credential.', 'authentication-failed')
    }
    return credential
  }

  /**
   * Rotate a connection's credential at most once at a time.
   * A waiter observes the completed keychain write before it can retry, and a
   * request that already sees another caller's newer bundle never rotates the
   * stale refresh token a second time.
   */
  private async refreshCredential(
    connectionId: ConnectionId,
    origin: string,
    observed: CredentialPair,
  ): Promise<CredentialPair> {
    const active = this.#refreshes.get(connectionId)
    if (active !== undefined) return active

    const refresh = (async () => {
      const current = await this.requireCredential(connectionId)
      if (!sameCredential(current, observed)) return current
      const refreshed = await this.refresh(origin, current.refreshToken)
      await this.credentials.write(connectionId, refreshed)
      return refreshed
    })()
    this.#refreshes.set(connectionId, refresh)
    try {
      return await refresh
    } finally {
      if (this.#refreshes.get(connectionId) === refresh) this.#refreshes.delete(connectionId)
    }
  }

  private async send(origin: string, request: OryhRequest, accessKey: string): Promise<FetchResponse> {
    return this.fetcher(apiPath(origin, request.path), {
      method: request.method ?? 'GET',
      headers: {
        'X-API-Key': accessKey,
        ...request.body === undefined ? {} : { 'Content-Type': 'application/json' },
      },
      ...request.body === undefined ? {} : { body: JSON.stringify(request.body) },
    })
  }

  private async refresh(origin: string, refreshToken: string): Promise<CredentialPair> {
    const response = await this.fetcher(apiPath(origin, '/auth/token/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    const body = await response.json()
    if (!response.ok) {
      throw new OryhClientError('ORYH credential refresh failed.', 'refresh-failed', response.status)
    }
    return asCredential(body)
  }
}

/** Whether the server-provided access expiry falls within this connection's refresh window. */
function shouldRefresh(credential: CredentialPair, now: Date, refreshAheadMs: number): boolean {
  if (credential.expiresAt === null) return false
  const expiresAt = Date.parse(credential.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime() + refreshAheadMs
}

/** Compare complete credential generations without ever exposing either value to a caller. */
function sameCredential(left: CredentialPair, right: CredentialPair): boolean {
  return left.accessKey === right.accessKey
    && left.refreshToken === right.refreshToken
    && left.expiresAt === right.expiresAt
}

/** Normalize one host-owned refresh lead time before network work begins. */
function refreshAheadMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_REFRESH_AHEAD_MS
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new TypeError('ORYH refreshAheadMs must be a non-negative safe integer')
  }
  return resolved
}

function requestError(response: FetchResponse, body: unknown): OryhClientError {
  return new OryhClientError(
    // Server detail may be useful to a person but is untrusted response data;
    // never promote it into a broadly logged local error where a proxy or
    // future server implementation could have echoed credential material.
    `ORYH request failed with status ${response.status}.`,
    response.status === 401 ? 'authentication-failed' : 'request-failed',
    response.status,
  )
}
