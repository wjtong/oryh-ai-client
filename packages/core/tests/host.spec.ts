import { describe, expect, it } from 'vitest'
import {
  connectionId,
  MemoryCredentialVault,
  MemoryConnectionStore,
  OryhClientHost,
} from '../src/index.js'
import { jsonResponse, ScriptedFetcher } from './fixtures.js'

describe('OryhClientHost', () => {
  it('owns a device connection and removes its credential on disconnect', async () => {
    const credentials = new MemoryCredentialVault()
    const fetcher = new ScriptedFetcher([
      jsonResponse(201, {
        data: {
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://oryh.example/web/device',
          verification_uri_complete: 'https://oryh.example/web/device?code=ABCD-EFGH',
          expires_in: 900,
          interval: 5,
        },
        meta: {},
      }),
      jsonResponse(200, {
        data: {
          status: 'approved',
          api_key: 'issued-access-key',
          refresh_token: 'issued-refresh-token',
          expires_at: null,
        },
        meta: {},
      }),
      jsonResponse(200, {
        data: {
          id: 'user-1',
          email: 'member@example.com',
          name: null,
          role: 'member',
          employee_id: 'employee-1',
          tenant_id: 'tenant-1',
          tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme' },
          environment_id: null,
        },
        meta: {},
      }),
    ])
    const host = new OryhClientHost({ credentialVault: credentials, fetcher: fetcher.fetch })

    const attempt = await host.beginDeviceConnection('https://oryh.example', 'ORYH AI Client')
    const outcome = await attempt.pollOnce()
    if (outcome.state !== 'connected') throw new Error('Expected a connected device flow')

    await expect(host.connections()).resolves.toEqual([outcome.connection])
    await host.disconnect(outcome.connection.id)
    await expect(host.connections()).resolves.toEqual([])
    await expect(credentials.read(outcome.connection.id)).resolves.toBeUndefined()
  })

  it('restores only persisted connection metadata with a matching credential entry', async () => {
    const credentials = new MemoryCredentialVault()
    const store = new MemoryConnectionStore([{
      id: connectionId('oryh-1'),
      origin: 'https://oryh.example',
      identity: {
        user: { id: 'user-1', email: 'member@example.com', name: 'Member', role: 'member', employeeId: 'employee-1' },
        tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme', environmentId: null },
      },
      connectedAt: '2026-08-28T00:00:00Z',
    }])
    await credentials.write(connectionId('oryh-1'), {
      accessKey: 'restored-access-key', refreshToken: 'restored-refresh-token', expiresAt: null,
    })
    const host = new OryhClientHost({ credentialVault: credentials, connectionStore: store, fetcher: async () => {
      throw new Error('No network request expected while restoring')
    } })

    await expect(host.connections()).resolves.toMatchObject([{ id: 'oryh-1', identity: { tenant: { slug: 'acme' } } }])
  })

  it('drops stale metadata whose matching credential has been removed from the keychain', async () => {
    const store = new MemoryConnectionStore([{
      id: connectionId('oryh-1'),
      origin: 'https://oryh.example',
      identity: {
        user: { id: 'user-1', email: 'member@example.com', name: 'Member', role: 'member', employeeId: 'employee-1' },
        tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme', environmentId: null },
      },
      connectedAt: '2026-08-28T00:00:00Z',
    }])
    const host = new OryhClientHost({ credentialVault: new MemoryCredentialVault(), connectionStore: store, fetcher: async () => {
      throw new Error('No network request expected while restoring')
    } })

    await expect(host.connections()).resolves.toEqual([])
    await expect(store.load()).resolves.toEqual([])
  })

  it('verifies a restored credential against the same stable ORYH user and tenant before publishing operations', async () => {
    const id = connectionId('oryh-1')
    const credentials = new MemoryCredentialVault()
    await credentials.write(id, {
      accessKey: 'restored-access-key', refreshToken: 'restored-refresh-token', expiresAt: null,
    })
    const store = new MemoryConnectionStore([{
      id,
      origin: 'https://oryh.example',
      identity: {
        user: { id: 'user-1', email: 'member@example.com', name: 'Member', role: 'member', employeeId: 'employee-1' },
        tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme', environmentId: null },
      },
      connectedAt: '2026-08-28T00:00:00Z',
    }])
    const fetcher = new ScriptedFetcher([
      jsonResponse(200, {
        data: {
          id: 'user-1', email: 'member@example.com', name: 'Member', role: 'manager', employee_id: 'employee-1',
          tenant_id: 'tenant-1', tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme' }, environment_id: null,
        }, meta: {},
      }),
    ])
    const host = new OryhClientHost({ credentialVault: credentials, connectionStore: store, fetcher: fetcher.fetch })

    await expect(host.verifyConnection(id)).resolves.toMatchObject({ identity: { user: { role: 'manager' } } })
    await expect(store.load()).resolves.toMatchObject([{ identity: { user: { role: 'manager' } } }])
    expect(fetcher.calls[0]?.input).toBe('https://oryh.example/api/v1/auth/me')
  })

  it('rejects a restored connection when the credential resolves to another ORYH user or tenant', async () => {
    const id = connectionId('oryh-1')
    const credentials = new MemoryCredentialVault()
    await credentials.write(id, {
      accessKey: 'restored-access-key', refreshToken: 'restored-refresh-token', expiresAt: null,
    })
    const store = new MemoryConnectionStore([{
      id,
      origin: 'https://oryh.example',
      identity: {
        user: { id: 'user-1', email: 'member@example.com', name: 'Member', role: 'member', employeeId: 'employee-1' },
        tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme', environmentId: null },
      },
      connectedAt: '2026-08-28T00:00:00Z',
    }])
    const fetcher = new ScriptedFetcher([
      jsonResponse(200, {
        data: {
          id: 'user-2', email: 'other@example.com', name: 'Other', role: 'member', employee_id: 'employee-2',
          tenant_id: 'tenant-1', tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme' }, environment_id: null,
        }, meta: {},
      }),
    ])
    const host = new OryhClientHost({ credentialVault: credentials, connectionStore: store, fetcher: fetcher.fetch })

    await expect(host.verifyConnection(id)).rejects.toMatchObject({ code: 'connection-identity-mismatch' })
  })
})
