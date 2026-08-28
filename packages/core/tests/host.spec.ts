import { describe, expect, it } from 'vitest'
import {
  MemoryCredentialVault,
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

    expect(host.connections()).toEqual([outcome.connection])
    await host.disconnect(outcome.connection.id)
    expect(host.connections()).toEqual([])
    await expect(credentials.read(outcome.connection.id)).resolves.toBeUndefined()
  })
})
