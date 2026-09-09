import type {ProjectChatState,ProjectChatProposal} from '@oryh/dsh-host/types'
import type {OryhProjectRemote} from '@oryh/ai-client-core/types'
import type { ChatPageRequest, ChatHomeRequest, ChatNavigation } from '@oryh/dsh-host/types'
import type { TimesheetChatState, TimesheetChatPoll, TimesheetChatProposal } from '@oryh/dsh-host/types'
import type { ChatSelection, ChatContextView } from '@oryh/dsh-host/types'
import type { TodoDocument } from '@oryh/ai-client-core/types'
import { createContext, useContext } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@oryh/dsh-host/remote'
import type { OryhClientRemote, OryhExpenseRemote, OryhTimesheetRemote, ConnectionId } from '@oryh/ai-client-core/types'

interface BusinessChatRemote { projectChatSync(request:ProjectChatState):Promise<void>;projectChatPoll(request:ChatHomeRequest):Promise<ProjectChatProposal|undefined>;projectChatClear(sessionId:string):Promise<void>; chatPageSync(request:ChatPageRequest):Promise<void>; chatHomePoll(request:ChatHomeRequest):Promise<ChatNavigation|undefined>; chatHomeClear(sessionId:string):Promise<void>; timesheetChatSync(request:TimesheetChatState):Promise<void>; timesheetChatPoll(request:TimesheetChatPoll):Promise<TimesheetChatProposal|undefined>; todoDetail(connectionId: string, todoId: string): Promise<TodoDocument>; chatSelect(request: ChatSelection): Promise<ChatContextView>; chatClear(sessionId: string): Promise<void> }
export type BusinessRemote = BusinessChatRemote & OryhProjectRemote & OryhClientRemote & OryhExpenseRemote & OryhTimesheetRemote
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
    projectOptions:id=>unwrap(api.projectOptions(connection(id))),
    projectPrepare:(id,fields)=>unwrap(api.projectPrepare({...connection(id),fields})),
    projectConfirm:(id,key,revision,token)=>unwrap(api.projectConfirm({...connection(id),id:key,revision,token})),
    projectHistory:id=>unwrap(api.projectHistory(connection(id))),
    projectReconcile:(id,key,revision)=>unwrap(api.projectReconcile({...connection(id),id:key,revision})),
    projectChatSync:r=>unwrap(api.projectChatSync(r)),
    projectChatPoll:r=>unwrap(api.projectChatPoll(r)),
    projectChatClear:sessionId=>unwrap(api.projectChatClear({sessionId})),
    chatPageSync: request => unwrap(api.chatPageSync(request)),
    chatHomePoll: request => unwrap(api.chatHomePoll(request)),
    chatHomeClear: sessionId => unwrap(api.chatHomeClear({sessionId})),
    timesheetChatSync: request => unwrap(api.timesheetChatSync(request)),
    timesheetChatPoll: request => unwrap(api.timesheetChatPoll(request)),
    todoDetail: (id, todoId) => unwrap(api.todoDetail({ ...connection(id), todoId })),
    chatSelect: request => unwrap(api.chatSelect(request)),
    chatClear: sessionId => unwrap(api.chatClear({ sessionId })),
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
    timesheetList: id => unwrap(api.timesheetList(connection(id))),
    timesheetQueue: id => unwrap(api.timesheetQueue(connection(id))),
    timesheetOptions: id => unwrap(api.timesheetOptions(connection(id))),
    timesheetDetail: (id, headerId, todoId) => unwrap(api.timesheetDetail({ ...connection(id), headerId, ...(todoId ? { todoId } : {}) })),
    timesheetHistory: id => unwrap(api.timesheetHistory(connection(id))),
    timesheetPrepare: (id, action) => unwrap(api.timesheetPrepare({ ...connection(id), action })),
    timesheetConfirm: (cid, id, revision, token) => unwrap(api.timesheetConfirm({ ...connection(cid), id, revision, token })),
    timesheetReconcile: (cid, id, revision) => unwrap(api.timesheetReconcile({ ...connection(cid), id, revision })),
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
