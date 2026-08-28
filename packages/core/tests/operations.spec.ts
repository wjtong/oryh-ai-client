import { describe, expect, it } from 'vitest'
import {
  agentContextForTodos,
  ConnectionRegistry,
  MemoryCredentialVault,
  OperationExecutor,
  OryhClientError,
  OryhHttpClient,
} from '../src/index.js'
import { jsonResponse, ScriptedFetcher } from './fixtures.js'

function identity(employeeId: string) {
  return {
    user: {
      id: `user-${employeeId}`,
      email: `${employeeId}@example.com`,
      name: null,
      role: 'member',
      employeeId,
    },
    tenant: {
      id: 'tenant-1',
      slug: 'acme',
      name: 'Acme',
      environmentId: null,
    },
  }
}

describe('OperationExecutor', () => {
  it('executes a registered todo operation once and reuses the result locally', async () => {
    const connections = new ConnectionRegistry()
    const first = connections.add({ origin: 'https://oryh.example', identity: identity('employee-1') })
    const second = connections.add({ origin: 'https://oryh.example', identity: identity('employee-2') })
    const credentials = new MemoryCredentialVault()
    await credentials.write(first.id, { accessKey: 'first-key', refreshToken: 'first-refresh', expiresAt: null })
    await credentials.write(second.id, { accessKey: 'second-key', refreshToken: 'second-refresh', expiresAt: null })
    const fetcher = new ScriptedFetcher([
      jsonResponse(200, {
        data: [{
          id: 'todo-1',
          employee_id: 'employee-1',
          entity_type: 'project',
          entity_id: 'project-1',
          title: 'Review project plan',
          description: null,
          todo_type: null,
          status: 'open',
          due_at: null,
          target: { entity_type: 'project', entity_id: 'project-1', title: 'Pilot', deleted: false },
        }],
        meta: { total: 1 },
      }),
    ])
    const http = new OryhHttpClient(connections, credentials, fetcher.fetch)
    const executor = new OperationExecutor(connections, http, () => new Date('2026-08-28T00:00:00Z'))

    const result = await executor.execute(first.id, 'my-open-todos')
    const reused = executor.reuse(first.id, result.id)

    expect(reused).toEqual(result)
    expect(fetcher.calls).toHaveLength(1)
    expect(fetcher.calls[0]?.input).toContain('employee_id=employee-1')
    expect(fetcher.calls[0]?.input).toContain('status=open')
    let crossConnectionError: unknown
    try {
      executor.reuse(second.id, result.id)
    } catch (error) {
      crossConnectionError = error
    }
    expect(crossConnectionError).toBeInstanceOf(OryhClientError)
    expect((crossConnectionError as OryhClientError).code).toBe('cross-connection-result')
    const context = agentContextForTodos(result, { id: 'tenant-1', slug: 'acme' })
    expect(context).toMatchObject({
      source: 'oryh-deterministic-operation',
      items: [{ title: 'Review project plan', targetTitle: 'Pilot' }],
    })
    expect(JSON.stringify(context)).not.toContain('first-key')
  })
})
