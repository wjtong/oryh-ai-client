import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  connectionId,
  deviceAuthorizationId,
  operationResultId,
  savedOperationId,
  type OryhClientRemote,
} from '@oryh/ai-client-core'
import { createOryhApiHandler } from './http.js'

const connection = {
  id: connectionId('oryh-1'),
  origin: 'http://127.0.0.1:8080',
  identity: {
    user: { id: 'user-1', email: 'member@example.com', name: 'Member', role: 'member', employeeId: 'employee-1' },
    tenant: { id: 'tenant-1', slug: 'tenant', name: 'Tenant', environmentId: null },
  },
  connectedAt: '2026-08-29T00:00:00Z',
} as const

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('createOryhApiHandler', () => {
  it('returns browser-safe connection summaries from an allowlisted route', async () => {
    const remote = remoteFixture()
    const origin = await start(remote)

    const response = await fetch(`${origin}/api/client/connections`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [connection] })
    expect(remote.calls).toEqual(['listConnections'])
  })

  it('runs only an allowlisted operation for an existing local connection', async () => {
    const remote = remoteFixture()
    const origin = await start(remote)

    const response = await fetch(`${origin}/api/client/operations/list-projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: connection.id }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { operationId: 'list-projects', connectionId: connection.id } })
    expect(remote.calls).toEqual(['execute:list-projects'])
  })

  it('verifies a restored connection through one named loopback Remote route', async () => {
    const remote = remoteFixture()
    const origin = await start(remote)

    const response = await fetch(`${origin}/api/client/connections/${connection.id}/verify`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: connection })
    expect(remote.calls).toEqual(['verifyConnection'])
  })

  it('rejects cross-origin browser requests before calling the Remote', async () => {
    const remote = remoteFixture()
    const origin = await start(remote)

    const response = await fetch(`${origin}/api/client/connections`, { headers: { Origin: 'https://untrusted.example' } })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'cross-origin-denied', message: '本地客户端拒绝跨站请求。' },
    })
    expect(remote.calls).toEqual([])
  })
})

async function start(remote: OryhClientRemote): Promise<string> {
  const server = createServer((request, response) => {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address.')
    const handler = createOryhApiHandler(remote, { expectedOrigin: `http://127.0.0.1:${address.port}` })
    void handler(request, response)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address.')
  return `http://127.0.0.1:${address.port}`
}

function remoteFixture(): OryhClientRemote & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    beginConnection: async () => ({
      authorizationId: deviceAuthorizationId('authorization-1'),
      prompt: {
        userCode: 'ABCD-EFGH', verificationUri: 'https://oryh.example/web/device',
        verificationUriComplete: 'https://oryh.example/web/device?code=ABCD-EFGH', expiresInSeconds: 900, pollIntervalSeconds: 5,
      },
    }),
    pollConnection: async () => ({ state: 'connected' as const, connection }),
    cancelConnection: async () => undefined,
    listConnections: async () => { calls.push('listConnections'); return [connection] },
    verifyConnection: async () => { calls.push('verifyConnection'); return connection },
    listOperations: async () => [],
    execute: async (_connectionId, operationId) => {
      calls.push(`execute:${operationId}`)
      return {
        id: operationResultId('result-1'), operationId, connectionId: connection.id, executedAt: '2026-08-29T00:00:00Z',
        result: { data: [], meta: { total: 0, page: null, pageSize: null, pages: null } },
      }
    },
    reuse: async () => ({
      id: operationResultId('result-1'), operationId: 'list-projects' as const, connectionId: connection.id, executedAt: '2026-08-29T00:00:00Z',
      result: { data: [], meta: { total: 0, page: null, pageSize: null, pages: null } },
    }),
    saveResult: async () => ({
      id: savedOperationId('saved-operation-1'), connectionId: connection.id, operationId: 'list-projects' as const,
      sourceResultId: operationResultId('result-1'), label: '项目列表', createdAt: '2026-08-29T00:00:00Z',
    }),
    listSavedOperations: async () => [],
    refreshSavedOperation: async () => ({
      id: operationResultId('result-1'), operationId: 'list-projects' as const, connectionId: connection.id, executedAt: '2026-08-29T00:00:00Z',
      result: { data: [], meta: { total: 0, page: null, pageSize: null, pages: null } },
    }),
    disconnect: async () => undefined,
  }
}
