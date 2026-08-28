import type { ConnectionId, OperationResultId } from './brand.js'
import { ConnectionRegistry, type ConnectionSummary } from './connections.js'
import type { OryhProject, OryhTodo } from './contracts.js'
import type { CredentialVault } from './credentials.js'
import { DeviceFlowConnector, type DeviceConnectionAttempt } from './device-flow.js'
import type { Fetcher } from './http.js'
import { OryhHttpClient } from './http.js'
import { OperationExecutor, type OperationResult } from './operations.js'

/** Dependencies owned by a native shell or DSH Host integration. */
export interface OryhClientHostOptions {
  /** Host-only secret store; production supplies an OS-keychain adapter. */
  readonly credentialVault: CredentialVault
  /** Host network transport; production normally passes `globalThis.fetch`. */
  readonly fetcher: Fetcher
  /** Injectable clock for deterministic receipts and tests. */
  readonly clock?: () => Date
}

/**
 * Product Host facade: connection lifecycle and registered business operations.
 * It never exposes credentials, HTTP transport, or the mutable connection registry.
 */
export class OryhClientHost {
  readonly #connections = new ConnectionRegistry()
  readonly #http: OryhHttpClient
  readonly #devices: DeviceFlowConnector
  readonly #operations: OperationExecutor
  readonly #credentials: CredentialVault

  constructor(options: OryhClientHostOptions) {
    this.#credentials = options.credentialVault
    this.#http = new OryhHttpClient(this.#connections, this.#credentials, options.fetcher)
    this.#devices = new DeviceFlowConnector(this.#connections, this.#credentials, options.fetcher)
    this.#operations = new OperationExecutor(this.#connections, this.#http, options.clock)
  }

  /** Start browser-backed device authorization for one ORYH deployment. */
  beginDeviceConnection(origin: string, clientName: string): Promise<DeviceConnectionAttempt> {
    return this.#devices.begin(origin, clientName)
  }

  /** List non-secret connection summaries for a local UI or Remote response. */
  connections(): readonly ConnectionSummary[] {
    return this.#connections.list()
  }

  /** Execute the employee-bound "my open todos" operation. */
  executeMyOpenTodos(connectionId: ConnectionId): Promise<OperationResult<OryhTodo>> {
    return this.#operations.execute(connectionId, 'my-open-todos')
  }

  /** Execute the tenant-bound project-list operation. */
  executeProjects(connectionId: ConnectionId): Promise<OperationResult<OryhProject>> {
    return this.#operations.execute(connectionId, 'list-projects')
  }

  /** Reuse a prior todo result without making a new ORYH request. */
  reuseTodoResult(connectionId: ConnectionId, resultId: OperationResultId): OperationResult<OryhTodo> {
    return this.#operations.reuse(connectionId, resultId)
  }

  /** Reuse a prior project result without making a new ORYH request. */
  reuseProjectResult(connectionId: ConnectionId, resultId: OperationResultId): OperationResult<OryhProject> {
    return this.#operations.reuse(connectionId, resultId)
  }

  /** Forget all local state and Host credentials for one disconnected enterprise. */
  async disconnect(connectionId: ConnectionId): Promise<void> {
    this.#connections.require(connectionId)
    await this.#credentials.remove(connectionId)
    this.#connections.remove(connectionId)
  }
}
