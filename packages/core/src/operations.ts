import { operationResultId, type ConnectionId, type OperationResultId } from './brand.js'
import type { ConnectionRegistry } from './connections.js'
import { decodeProjects, decodeTodos, type OryhList, type OryhProject, type OryhTodo } from './contracts.js'
import { OryhClientError } from './errors.js'
import type { OryhHttpClient } from './http.js'

/** Operation names intentionally limited to registered ORYH product workflows. */
export type OperationId = 'my-open-todos' | 'list-projects'

/** Safe metadata used to draw operation buttons and explain their server calls. */
export interface OperationDefinition {
  readonly id: OperationId
  readonly title: string
  readonly description: string
  readonly method: 'GET'
  readonly path: string
}

/** Public, non-secret data from one deterministic operation execution. */
export interface OperationResult<Value> {
  readonly id: OperationResultId
  readonly operationId: OperationId
  readonly connectionId: ConnectionId
  readonly executedAt: string
  readonly result: OryhList<Value>
}

export const OPERATIONS: readonly OperationDefinition[] = [
  {
    id: 'my-open-todos',
    title: '我的待办',
    description: '读取当前登录员工尚未完成的待办及其业务目标。',
    method: 'GET',
    path: '/todos?status=open&include=target',
  },
  {
    id: 'list-projects',
    title: '项目列表',
    description: '读取当前企业可见的项目列表。',
    method: 'GET',
    path: '/projects',
  },
] as const

/** Host-owned executor for allowlisted deterministic ORYH operations. */
export class OperationExecutor {
  readonly #results = new Map<OperationResultId, OperationResult<OryhTodo | OryhProject>>()
  #nextResultId = 1

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly http: OryhHttpClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Execute one registered operation within a tenant-bound connection. */
  async execute(
    connectionId: ConnectionId,
    operationId: 'my-open-todos',
  ): Promise<OperationResult<OryhTodo>>
  async execute(
    connectionId: ConnectionId,
    operationId: 'list-projects',
  ): Promise<OperationResult<OryhProject>>
  async execute(
    connectionId: ConnectionId,
    operationId: OperationId,
  ): Promise<OperationResult<OryhTodo> | OperationResult<OryhProject>> {
    const connection = this.connections.require(connectionId)
    let result: OryhList<OryhTodo> | OryhList<OryhProject>
    switch (operationId) {
      case 'my-open-todos': {
        if (connection.identity.user.employeeId === null) {
          throw new OryhClientError('This ORYH user is not linked to an employee.', 'request-failed')
        }
        const query = new URLSearchParams({
          employee_id: connection.identity.user.employeeId,
          status: 'open',
          include: 'target',
        })
        result = decodeTodos(await this.http.request(connectionId, { path: `/todos?${query.toString()}` }))
        break
      }
      case 'list-projects':
        result = decodeProjects(await this.http.request(connectionId, { path: '/projects' }))
        break
      default:
        return assertNever(operationId)
    }
    const execution = {
      id: operationResultId(`result-${this.#nextResultId}`),
      operationId,
      connectionId,
      executedAt: this.clock().toISOString(),
      result,
    }
    this.#nextResultId += 1
    this.#results.set(execution.id, execution)
    return execution as OperationResult<OryhTodo> | OperationResult<OryhProject>
  }

  /** Read a prior result without issuing a new ORYH API request. */
  reuse<Value extends OryhTodo | OryhProject>(
    connectionId: ConnectionId,
    resultId: OperationResultId,
  ): OperationResult<Value> {
    const result = this.#results.get(resultId)
    if (result === undefined) {
      throw new OryhClientError('The requested ORYH operation result no longer exists.', 'operation-not-found')
    }
    if (result.connectionId !== connectionId) {
      throw new OryhClientError(
        'An ORYH result cannot be reused across connections.',
        'cross-connection-result',
      )
    }
    return result as OperationResult<Value>
  }
}

function assertNever(value: never): never {
  throw new OryhClientError(`Unsupported ORYH operation: ${String(value)}`, 'operation-not-found')
}
