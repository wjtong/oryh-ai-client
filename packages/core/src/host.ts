import type { ServerReadBinding } from './server-read.js'
import {RecordService} from '@oryh/ai-client-records'
import {ProjectService,type ProjectStore} from '@oryh/ai-client-projects'
import { TodoDetailService } from '@oryh/ai-client-todos'
import { TimesheetService, type TimesheetStore } from '@oryh/ai-client-timesheets'
import { ExpenseService, type ExpenseStore, type OryhExpenseRemote } from '@oryh/ai-client-expenses'
import type { ConnectionId, OperationResultId } from './brand.js'
import type { ConnectionStore } from './connection-store.js'
import { ConnectionRegistry, type ConnectionSummary } from './connections.js'
import { decodeIdentity, type OryhExpenseClaim, type OryhProject, type OryhTodo } from './contracts.js'
import { OryhClientError } from './errors.js'
import type { CredentialVault } from './credentials.js'
import { DeviceFlowConnector, type DeviceConnectionAttempt } from './device-flow.js'
import type { Fetcher } from './http.js'
import { OryhHttpClient } from './http.js'
import { SkillBundleService } from './skill-bundle.js'
import { WorkflowDefinitions } from './workflow.js'
import { ListParameters } from './list-parameters.js'
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
  /** Trusted server-only binding. Use createServerReadHost rather than browser configuration. */
  readonly serverReadBinding?: ServerReadBinding
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
  private readonly serverBinding: ServerReadBinding | undefined
  private detachServer: () => void = () => {}
  readonly #verifications = new Map<ConnectionId, Promise<ConnectionSummary>>()

  constructor(options: OryhClientHostOptions) {
    if (options.serverReadBinding && options.connectionStore) throw new Error('Server binding cannot restore desktop connections')
    this.serverBinding = options.serverReadBinding
    this.#credentials = options.credentialVault
    this.#connectionStore = options.connectionStore
    this.#http = new OryhHttpClient(this.#connections, this.#credentials, options.fetcher, options.serverReadBinding ? { delegated: options.serverReadBinding } : {})
    this.#devices = new DeviceFlowConnector(
      this.#connections,
      this.#credentials,
      options.fetcher,
      async () => this.persistConnections(),
    )
    this.#operations = new OperationExecutor(this.#connections, this.#http, options.clock)
    this.#ready = this.restoreConnections()
    if (this.serverBinding) {
      const revoke = () => { for (const connection of this.#connections.list()) {
        this.#connections.revokeVerification(connection.id); this.#operations.clearConnection(connection.id)
        void this.#http.close(connection.id)
      } }
      this.serverBinding.signal.addEventListener('abort', revoke, { once: true })
      this.detachServer = () => this.serverBinding?.signal.removeEventListener('abort', revoke)
      if (this.serverBinding.signal.aborted) revoke()
    }
  }

  /** Build a browser-safe expense workflow over the same verified connection and transport. */
  /** Concrete service, not the narrow Remote interface: the Host also installs its submit gate. */
  createExpenseRemote(store: ExpenseStore) {
    return new ExpenseService(store, this.#http, id => this.#connections.requireVerified(id as ConnectionId),
      id => this.verifyConnection(id as ConnectionId))
  }

  /** Records read with server-side filters, checked against what each list endpoint declares. */
  createRecordRemote(){const declared=new ListParameters(this.#http);return new RecordService(this.#http,id=>this.verifyConnection(id as ConnectionId),id=>this.#connections.requireVerified(id as ConnectionId),(id,path)=>declared.of(id,path))}
  createProjectRemote(store:ProjectStore){return new ProjectService(store,this.#http,id=>this.#connections.requireVerified(id as ConnectionId),id=>this.verifyConnection(id as ConnectionId))}
  createTodoDetailRemote() { return new TodoDetailService(this.#http, id => this.#connections.requireVerified(id as ConnectionId), async id => { await this.#ready; await this.#verifications.get(id as ConnectionId); return this.#connections.requireVerified(id as ConnectionId) }) }
  createTimesheetRemote(store: TimesheetStore) { return new TimesheetService(store, this.#http, id => this.#connections.requireVerified(id as ConnectionId), id => this.verifyConnection(id as ConnectionId)) }
  /** Which object types this tenant governs with a workflow definition; shared by every domain. */
  createWorkflowDefinitions() { return new WorkflowDefinitions(this.#http) }
  /** ORYH skill bundle installer; the credential stays inside the shared HTTP client. */
  createSkillBundle(root: string) {
    if (this.serverBinding) throw new OryhClientError('Server skills are delivered through MCP.', 'request-failed')
    // The holder is read from the connection as already verified. Starting a verification here would
    // clear the connection's in-flight business reads, and a skill sync runs whenever the workbench opens.
    return new SkillBundleService(this.#http, root, async id => {
      await this.#ready
      await this.#verifications.get(id)
      const { origin, identity } = this.#connections.requireVerified(id)
      return { origin, tenantId: identity.tenant.id, userId: identity.user.id, employeeId: identity.user.employeeId, tenantName: identity.tenant.name ?? identity.tenant.slug, email: identity.user.email }
    })
  }

  /** Start browser-backed device authorization for one ORYH deployment. */
  async beginDeviceConnection(origin: string, clientName: string): Promise<DeviceConnectionAttempt> {
    await this.#ready
    if (this.serverBinding) throw new OryhClientError('Server connections use the authenticated browser login.', 'request-failed')
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
    if (this.serverBinding) this.detachServer()
    await this.persistConnections()
  }

  /** Confirm that a connection belongs to the restored and active Host registry. */
  async connection(connectionId: ConnectionId): Promise<ConnectionSummary> {
    await this.#ready
    return this.#connections.require(connectionId)
  }

  private async restoreConnections(): Promise<void> {
    if (this.serverBinding) {
      const connection = this.#connections.add({ origin: this.serverBinding.origin, identity: this.serverBinding.identity })
      await this.verifyIdentity(connection.id)
      return
    }
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
