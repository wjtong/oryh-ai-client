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
  return {
    accessKey: fields.api_key,
    refreshToken: fields.refresh_token,
    expiresAt: expiresAt ?? null,
  }
}

/** Host-only HTTP adapter that injects credentials, refreshes once, and never returns them. */
export class OryhHttpClient {
  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly credentials: CredentialVault,
    private readonly fetcher: Fetcher,
  ) {}

  /** Call a versioned ORYH API endpoint inside one existing connection scope. */
  async request(connectionId: ConnectionId, request: OryhRequest): Promise<unknown> {
    const connection = this.connections.require(connectionId)
    const credential = await this.credentials.read(connectionId)
    if (credential === undefined) {
      throw new OryhClientError('The ORYH connection has no credential.', 'authentication-failed')
    }
    const first = await this.send(connection.origin, request, credential.accessKey)
    const firstBody = await first.json()
    if (first.ok) return firstBody
    if (!expiredKey(first, firstBody)) throw requestError(first, firstBody)

    const refreshed = await this.refresh(connection.origin, credential.refreshToken)
    await this.credentials.write(connectionId, refreshed)
    const second = await this.send(connection.origin, request, refreshed.accessKey)
    const secondBody = await second.json()
    if (second.ok) return secondBody
    throw requestError(second, secondBody)
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
