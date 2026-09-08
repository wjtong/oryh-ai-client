import { ExpenseService } from './expenses.js'
import type { ExpenseStore } from './expense-store.js'
import type { OryhExpenseRemote } from './expense-contracts.js'
import type { ConnectionId, OperationResultId } from './brand.js'
import type { ConnectionStore } from './connection-store.js'
import { ConnectionRegistry, type ConnectionSummary } from './connections.js'
import { decodeIdentity, type OryhExpenseClaim, type OryhProject, type OryhTodo } from './contracts.js'
import { OryhClientError } from './errors.js'
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
  /** Non-secret connection metadata store; production persists it outside the credential vault. */
  readonly connectionStore?: ConnectionStore
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
  readonly #connectionStore: ConnectionStore | undefined
  readonly #ready: Promise<void>
  readonly #verifications = new Map<ConnectionId, Promise<ConnectionSummary>>()

  constructor(options: OryhClientHostOptions) {
    this.#credentials = options.credentialVault
    this.#connectionStore = options.connectionStore
    this.#http = new OryhHttpClient(this.#connections, this.#credentials, options.fetcher)
    this.#devices = new DeviceFlowConnector(
      this.#connections,
      this.#credentials,
      options.fetcher,
      async () => this.persistConnections(),
    )
    this.#operations = new OperationExecutor(this.#connections, this.#http, options.clock)
    this.#ready = this.restoreConnections()
  }

  /** Build a browser-safe expense workflow over the same verified connection and transport. */
  createExpenseRemote(store: ExpenseStore): OryhExpenseRemote {
    return new ExpenseService(store, this.#http, id => this.#connections.requireVerified(id as ConnectionId),
      id => this.verifyConnection(id as ConnectionId))
  }

  /** Start browser-backed device authorization for one ORYH deployment. */
  async beginDeviceConnection(origin: string, clientName: string): Promise<DeviceConnectionAttempt> {
    await this.#ready
    return this.#devices.begin(origin, clientName)
  }

  /** List non-secret connection summaries for a local UI or Remote response. */
  async connections(): Promise<readonly ConnectionSummary[]> {
    await this.#ready
    return this.#connections.list()
  }

  /**
   * Verify a restored connection against the current ORYH credential before
   * publishing it for business operations. The stable user and tenant IDs may
   * not change under one local connection; mutable identity facts may refresh.
   */
  async verifyConnection(connectionId: ConnectionId): Promise<ConnectionSummary> {
    await this.#ready
    const active = this.#verifications.get(connectionId)
    if (active !== undefined) return active
    const verification = this.verifyIdentity(connectionId)
    this.#verifications.set(connectionId, verification)
    try {
      return await verification
    } finally {
      this.#verifications.delete(connectionId)
    }
  }

  private async verifyIdentity(connectionId: ConnectionId): Promise<ConnectionSummary> {
    const existing = this.#connections.require(connectionId)
    this.#connections.revokeVerification(connectionId)
    this.#operations.clearConnection(connectionId)
    const identity = decodeIdentity(await this.#http.request(connectionId, { path: '/auth/me' }))
    if (identity.user.id !== existing.identity.user.id || identity.tenant.id !== existing.identity.tenant.id) {
      throw new OryhClientError(
        'ORYH authentication no longer belongs to this local connection.',
        'connection-identity-mismatch',
      )
    }
    this.#http.assertOpen(connectionId)
    const verified = this.#connections.markVerified(connectionId, identity)
    await this.persistConnections()
    return verified
  }

  /** Execute the employee-bound "my open todos" operation. */
  async executeMyOpenTodos(connectionId: ConnectionId): Promise<OperationResult<OryhTodo>> {
    await this.#ready
    return this.#operations.execute(connectionId, 'my-open-todos')
  }

  /** Execute the employee-bound "my expense claims" operation. */
  async executeMyExpenseClaims(connectionId: ConnectionId): Promise<OperationResult<OryhExpenseClaim>> {
    await this.#ready
    return this.#operations.execute(connectionId, 'my-expense-claims')
  }

  /** Execute the tenant-bound project-list operation. */
  async executeProjects(connectionId: ConnectionId): Promise<OperationResult<OryhProject>> {
    await this.#ready
    return this.#operations.execute(connectionId, 'list-projects')
  }

  /** Reuse a prior todo result without making a new ORYH request. */
  async reuseTodoResult(connectionId: ConnectionId, resultId: OperationResultId): Promise<OperationResult<OryhTodo>> {
    await this.#ready
    return this.#operations.reuse(connectionId, resultId, 'my-open-todos')
  }

  /** Reuse a prior expense-claim result without making a new ORYH request. */
  async reuseExpenseClaimResult(
    connectionId: ConnectionId,
    resultId: OperationResultId,
  ): Promise<OperationResult<OryhExpenseClaim>> {
    await this.#ready
    return this.#operations.reuse(connectionId, resultId, 'my-expense-claims')
  }

  /** Reuse a prior project result without making a new ORYH request. */
  async reuseProjectResult(connectionId: ConnectionId, resultId: OperationResultId): Promise<OperationResult<OryhProject>> {
    await this.#ready
    return this.#operations.reuse(connectionId, resultId, 'list-projects')
  }

  /** Forget all local state and Host credentials for one disconnected enterprise. */
  async disconnect(connectionId: ConnectionId): Promise<void> {
    await this.#ready
    this.#connections.require(connectionId)
    this.#connections.revokeVerification(connectionId)
    this.#operations.clearConnection(connectionId)
    await this.#http.close(connectionId)
    await this.#credentials.remove(connectionId)
    this.#connections.remove(connectionId)
    await this.persistConnections()
  }

  /** Confirm that a connection belongs to the restored and active Host registry. */
  async connection(connectionId: ConnectionId): Promise<ConnectionSummary> {
    await this.#ready
    return this.#connections.require(connectionId)
  }

  private async restoreConnections(): Promise<void> {
    if (this.#connectionStore === undefined) return
    const stored = await this.#connectionStore.load()
    const restorable: ConnectionSummary[] = []
    for (const connection of stored) {
      if (await this.#credentials.read(connection.id) !== undefined) restorable.push(connection)
    }
    this.#connections.restore(restorable)
    if (restorable.length !== stored.length) await this.persistConnections()
  }

  private async persistConnections(): Promise<void> {
    if (this.#connectionStore === undefined) return
    await this.#connectionStore.save(this.#connections.list())
  }
}
