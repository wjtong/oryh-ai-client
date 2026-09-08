import { createContext, useContext } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@oryh/dsh-host/remote'
import type { OryhClientRemote, OryhExpenseRemote, ConnectionId } from '@oryh/ai-client-core/types'

export type BusinessRemote = OryhClientRemote & OryhExpenseRemote
export const RemoteContext = createContext<BusinessRemote | undefined>(undefined)
export function useOryhRemote(): BusinessRemote {
  const remote = useContext(RemoteContext)
  if (!remote) throw new Error('ORYH Remote is not mounted')
  return remote
}
export class LocalRemoteError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'OryhRemoteError' }
}
async function unwrap<T>(call: Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string; details?: object } }>): Promise<T> {
  const result = await call
  if (!result.ok) {
    const details = result.error.details
    const code = result.error.code === 'oryh/business' && details && 'code' in details && typeof details.code === 'string' ? details.code : result.error.code
    throw new LocalRemoteError(code, result.error.message)
  }
  return result.value
}
/** The only browser transport is the generated, authenticated Harness Remote. */
export function createOryhRemote(remote: ClientRemote): BusinessRemote {
  const api = remote.oryh
  const connection = (connectionId: string) => ({ connectionId: connectionId as ConnectionId })
  return {
    listConnections: () => unwrap(api.listConnections()),
    listOperations: () => unwrap(api.listOperations()),
    beginConnection: (origin, clientName) => unwrap(api.beginConnection({ origin, clientName })),
    pollConnection: authorizationId => unwrap(api.pollConnection({ authorizationId })),
    cancelConnection: authorizationId => unwrap(api.cancelConnection({ authorizationId })),
    verifyConnection: connectionId => unwrap(api.verifyConnection({ connectionId })),
    disconnect: connectionId => unwrap(api.disconnect({ connectionId })),
    execute: (connectionId, operationId) => unwrap(api.execute({ connectionId, operationId })),
    reuse: (connectionId, operationId, resultId) => unwrap(api.reuse({ connectionId, operationId, resultId })),
    saveResult: (connectionId, operationId, resultId, label) => unwrap(api.saveResult({ connectionId, operationId, resultId, label })),
    listSavedOperations: connectionId => unwrap(api.listSavedOperations({ connectionId })),
    refreshSavedOperation: (connectionId, savedOperationId) => unwrap(api.refreshSavedOperation({ connectionId, savedOperationId })),
    expenseList: id => unwrap(api.expenseList(connection(id))),
    expenseOptions: id => unwrap(api.expenseOptions(connection(id))),
    expenseSave: (id, input) => unwrap(api.expenseSave({ ...connection(id), ...input })),
    expensePrepare: (cid, id, revision) => unwrap(api.expensePrepare({ ...connection(cid), id, revision })),
    expenseConfirm: (cid, id, revision, token) => unwrap(api.expenseConfirm({ ...connection(cid), id, revision, token })),
    expenseReconcile: (cid, id, revision) => unwrap(api.expenseReconcile({ ...connection(cid), id, revision })),
    expenseUpload: (id, input) => unwrap(api.expenseUpload({ ...connection(id), ...input })),
    expenseDelete: (cid, id, revision) => unwrap(api.expenseArchive({ ...connection(cid), id, revision })),
  }
}
