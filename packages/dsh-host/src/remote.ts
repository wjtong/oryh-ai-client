import { OryhClientRemoteAdapter, OryhClientError } from '@oryh/ai-client-core'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  BeginConnectionView, ConnectionId, ConnectionSummary, DeviceAuthorizationId, ExpenseDraft, ExpenseFields,
  OryhClientController, OryhExpenseRemote, OryhOperationResult, OperationDefinition, OperationId,
  OperationResultId, PollConnectionView, SavedOperationId, SavedOperationView,
} from '@oryh/ai-client-core'

import type { ConnectRequest, ConnectionRequest, AuthorizationRequest, OperationRequest, ResultRequest, SaveResultRequest, SavedRequest, DraftRequest, SaveDraftRequest, ConfirmDraftRequest, UploadRequest, ExpenseOptions, AttachmentReceipt } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    oryhAbort: () => void
    oryhClient: OryhClientController
    oryhExpenses: OryhExpenseRemote
    oryhRemote: OryhRemote
  }
}

/** Browser-only typed business API; no member is registered as an Agent tool. */
export class OryhRemote extends TypertRemoteService {
  static inject = ['typert', 'oryhClient', 'oryhExpenses', 'oryhAbort']
  private readonly api: OryhClientRemoteAdapter
  private closed = false
  private readonly active = new Set<Promise<unknown>>()
  constructor(ctx: Context) {
    super(ctx, 'oryhRemote', { namespace: 'oryh' })
    this.api = new OryhClientRemoteAdapter(ctx.oryhClient)
    const abort = ctx.oryhAbort
    ctx.effect(() => async () => {
      this.closed = true
      abort()
      await Promise.allSettled([...this.active])
    }, 'oryh pending requests')
  }
  @Remote('listConnections') listConnections(): Promise<readonly ConnectionSummary[]> { return this.call(() => this.ctx.oryhClient.listConnections()) }
  @Remote('beginConnection') beginConnection(request: ConnectRequest): Promise<BeginConnectionView> { return this.call(() => this.ctx.oryhClient.beginConnection(request.origin, request.clientName)) }
  @Remote('pollConnection') pollConnection(request: AuthorizationRequest): Promise<PollConnectionView> { return this.call(() => this.ctx.oryhClient.pollConnection(request.authorizationId)) }
  @Remote('cancelConnection') cancelConnection(request: AuthorizationRequest): Promise<void> { return this.call(() => this.ctx.oryhClient.cancelConnection(request.authorizationId)) }
  @Remote('verifyConnection') verifyConnection(request: ConnectionRequest): Promise<ConnectionSummary> { return this.call(() => this.ctx.oryhClient.verifyConnection(request.connectionId)) }
  @Remote('listOperations') listOperations(): Promise<readonly OperationDefinition[]> { return this.call(() => this.ctx.oryhClient.listOperations()) }
  @Remote('execute') execute(request: OperationRequest): Promise<OryhOperationResult> { return this.call(() => this.api.execute(request.connectionId, request.operationId)) }
  @Remote('reuse') reuse(request: ResultRequest): Promise<OryhOperationResult> { return this.call(() => this.api.reuse(request.connectionId, request.operationId, request.resultId)) }
  @Remote('saveResult') saveResult(request: SaveResultRequest): Promise<SavedOperationView> { return this.call(() => this.ctx.oryhClient.saveResult(request.connectionId, request.operationId, request.resultId, request.label)) }
  @Remote('listSavedOperations') listSavedOperations(request: ConnectionRequest): Promise<readonly SavedOperationView[]> { return this.call(() => this.ctx.oryhClient.listSavedOperations(request.connectionId)) }
  @Remote('refreshSavedOperation') refreshSavedOperation(request: SavedRequest): Promise<OryhOperationResult> { return this.call(() => this.ctx.oryhClient.refreshSavedOperation(request.connectionId, request.savedOperationId)) }
  @Remote('disconnect') disconnect(request: ConnectionRequest): Promise<void> { return this.call(() => this.ctx.oryhClient.disconnect(request.connectionId)) }
  @Remote('expenseList') expenseList(request: ConnectionRequest): Promise<ExpenseDraft[]> { return this.call(() => this.ctx.oryhExpenses.expenseList(request.connectionId)) }
  @Remote('expenseOptions') expenseOptions(request: ConnectionRequest): Promise<ExpenseOptions> { return this.call(() => this.ctx.oryhExpenses.expenseOptions(request.connectionId)) }
  @Remote('expenseSave') expenseSave(request: SaveDraftRequest): Promise<ExpenseDraft> { return this.call(() => this.ctx.oryhExpenses.expenseSave(request.connectionId, request)) }
  @Remote('expensePrepare') expensePrepare(request: DraftRequest): Promise<ExpenseDraft> { return this.call(() => this.ctx.oryhExpenses.expensePrepare(request.connectionId, request.id, request.revision)) }
  @Remote('expenseConfirm') expenseConfirm(request: ConfirmDraftRequest): Promise<ExpenseDraft> { return this.call(() => this.ctx.oryhExpenses.expenseConfirm(request.connectionId, request.id, request.revision, request.token)) }
  @Remote('expenseReconcile') expenseReconcile(request: DraftRequest): Promise<ExpenseDraft> { return this.call(() => this.ctx.oryhExpenses.expenseReconcile(request.connectionId, request.id, request.revision)) }
  @Remote('expenseUpload') expenseUpload(request: UploadRequest): Promise<AttachmentReceipt> { return this.call(() => this.ctx.oryhExpenses.expenseUpload(request.connectionId, request)) }
  @Remote('expenseArchive') expenseArchive(request: DraftRequest): Promise<void> { return this.call(() => this.ctx.oryhExpenses.expenseDelete(request.connectionId, request.id, request.revision)) }
  private async call<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.closed) throw new RemoteError('oryh/business', 'ORYH 插件已卸载。', { code: 'request-failed' })
    const pending = Promise.resolve().then(action)
    this.active.add(pending)
    try { return await pending } catch (error) {
      if (error instanceof OryhClientError) throw new RemoteError('oryh/business', error.message, { code: error.code })
      throw new RemoteError('oryh/business', 'ORYH 无法完成请求，请重试。', { code: 'request-failed' })
    } finally { this.active.delete(pending) }
  }

}
