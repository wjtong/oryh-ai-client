import { describe, expect, it } from 'vitest'
import {
  ConnectionRegistry,
  MemoryCredentialVault,
  OryhHttpClient,
} from '../src/index.js'
import { header, jsonResponse, ScriptedFetcher } from './fixtures.js'

function identity() {
  return {
    user: {
      id: 'user-1',
      email: 'member@example.com',
      name: 'Member',
      role: 'member',
      employeeId: 'employee-1',
    },
    tenant: {
      id: 'tenant-1',
      slug: 'acme',
      name: 'Acme',
      environmentId: 'production',
    },
  }
}

describe('OryhHttpClient', () => {
  it('refreshes an expired interactive key exactly once before retrying the request', async () => {
    const connections = new ConnectionRegistry()
    const connection = connections.add({ origin: 'https://oryh.example', identity: identity() })
    const credentials = new MemoryCredentialVault()
    await credentials.write(connection.id, {
      accessKey: 'expired-access-key',
      refreshToken: 'refresh-token',
      expiresAt: null,
    })
    const fetcher = new ScriptedFetcher([
      jsonResponse(401, { detail: 'API key expired — POST /auth/token/refresh' }),
      jsonResponse(200, {
        data: { api_key: 'fresh-access-key', refresh_token: 'fresh-refresh-token', expires_at: null },
        meta: {},
      }),
      jsonResponse(200, { data: [], meta: { total: 0 } }),
    ])
    const client = new OryhHttpClient(connections, credentials, fetcher.fetch)

    await expect(client.request(connection.id, { path: '/projects' })).resolves.toEqual({
      data: [],
      meta: { total: 0 },
    })

    expect(fetcher.calls.map(call => call.input)).toEqual([
      'https://oryh.example/api/v1/projects',
      'https://oryh.example/api/v1/auth/token/refresh',
      'https://oryh.example/api/v1/projects',
    ])
    expect(header(fetcher.calls[0]?.init, 'X-API-Key')).toBe('expired-access-key')
    expect(header(fetcher.calls[1]?.init, 'X-API-Key')).toBeUndefined()
    expect(header(fetcher.calls[2]?.init, 'X-API-Key')).toBe('fresh-access-key')
    await expect(credentials.read(connection.id)).resolves.toEqual({
      accessKey: 'fresh-access-key',
      refreshToken: 'fresh-refresh-token',
      expiresAt: null,
    })
  })
})
