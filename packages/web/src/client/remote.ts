import type {OryhRecordRemote} from '@oryh/ai-client-records'
import type {ProjectChatState} from '@oryh/dsh-host/types'
import type {OryhProjectRemote} from '@oryh/ai-client-projects'
import type { ChatPageRequest, ChatHomeRequest } from '@oryh/dsh-host/types'
import type { TimesheetChatState } from '@oryh/dsh-host/types'
import type { ChatSelection, ChatContextView } from '@oryh/dsh-host/types'
import type { TodoDocument } from '@oryh/ai-client-todos'
import { createContext, useContext } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { CommandFrame } from '@oryh/dsh-host/types'
import type { CommandState, CommandStreamHandle } from './command-stream.js'
import type {} from '@oryh/dsh-host/remote'
import type { OryhClientRemote } from '@oryh/ai-client-core/types'
import type { OryhExpenseRemote } from '@oryh/ai-client-expenses'
import type { ConnectionId } from '@oryh/ai-client-foundation'
import type { OryhTimesheetRemote } from '@oryh/ai-client-timesheets'

interface BusinessChatRemote { projectChatSync(request:ProjectChatState):Promise<void>;projectChatClear(sessionId:string):Promise<void>; chatPageSync(request:ChatPageRequest):Promise<void>; chatHomeClear(sessionId:string):Promise<void>; timesheetChatSync(request:TimesheetChatState):Promise<void>; openCommands(request:ChatHomeRequest):CommandStreamHandle; todoDetail(connectionId: string, todoId: string): Promise<TodoDocument>; chatSelect(request: ChatSelection): Promise<ChatContextView>; chatClear(sessionId: string): Promise<void> }
export type BusinessRemote = BusinessChatRemote & OryhRecordRemote & OryhProjectRemote & OryhClientRemote & OryhExpenseRemote & OryhTimesheetRemote
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
const streamName = 'ORYH command stream'
const reopenDelayMs = 1000

/** Resolve after `ms`, or as soon as the stream is disposed. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Follow one session's pending commands over the generated stream Remote.
 *
 * Every frame carries the full set, so reopening republishes a baseline and no command is
 * replayed or lost. The previous set stays published while the stream reopens; only a refusal
 * before any baseline is terminal, because that means the session is no longer bound.
 *
 * TODO(review §2): replace this loop with `remote.$stream`. It was written out on the belief
 * that an out-of-tree bundle cannot import Harness values; that was wrong — the cause was our
 * own esbuild external list, and the public stream classes are reachable (verified at
 * 0.1.5-rc.2, see docs/14). `$stream` is a plain service method needing no value import at all
 * and lets Connection pace retries, and `RemoteStreamCarrierError` is what marks a normal
 * generation end retryable. Until then the cost is a fixed reopen delay, and the pre-baseline
 * error handling below is knowingly too blunt: every such failure is treated as terminal.
 * @param remote - client Remote carrying the mounted ORYH namespace.
 * @param request - the session and connection to follow.
 * @returns an unstarted store owned by the caller.
 */
function createCommandStream(remote: ClientRemote, request: ChatHomeRequest): CommandStreamHandle {
  let state: CommandState = { commands: {} }
  let running: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const lifetime = new AbortController()
  const publish = (next: CommandState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  async function consume(): Promise<void> {
    while (!lifetime.signal.aborted) {
      let opened = false
      try {
        for await (const frame of remote.oryh.commands(request, lifetime.signal) as AsyncIterable<CommandFrame>) {
          if (lifetime.signal.aborted) return
          if (!opened && frame.type !== 'baseline') throw new Error(`${streamName} sent an update before its opening snapshot`)
          opened = true
          publish({ commands: frame.commands })
        }
      } catch (error) {
        if (lifetime.signal.aborted) return
        if (!opened) {
          publish({ ...state, error: error instanceof Error ? error.message : 'Chat 指令同步已中断。' })
          return
        }
      }
      if (lifetime.signal.aborted) return
      await delay(reopenDelayMs, lifetime.signal)
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    start: () => { running ??= consume() },
    dispose: async () => { lifetime.abort(new Error(`${streamName} disposed`)); await running },
  }
}

/** The only browser transport is the generated, authenticated Harness Remote. */
export function createOryhRemote(remote: ClientRemote): BusinessRemote {
  const api = remote.oryh
  const connection = (connectionId: string) => ({ connectionId: connectionId as ConnectionId })
  return {
    productSearch:q=>unwrap(api.productSearch(q)),
    recordList:q=>unwrap(api.recordList(q)),
    projectOptions:id=>unwrap(api.projectOptions(connection(id))),
    projectPrepare:(id,fields)=>unwrap(api.projectPrepare({...connection(id),fields})),
    projectConfirm:(id,key,revision,token)=>unwrap(api.projectConfirm({...connection(id),id:key,revision,token})),
    projectHistory:id=>unwrap(api.projectHistory(connection(id))),
    projectReconcile:(id,key,revision)=>unwrap(api.projectReconcile({...connection(id),id:key,revision})),
    projectChatSync:r=>unwrap(api.projectChatSync(r)),
    projectChatClear:sessionId=>unwrap(api.projectChatClear({sessionId})),
    chatPageSync: request => unwrap(api.chatPageSync(request)),
    chatHomeClear: sessionId => unwrap(api.chatHomeClear({sessionId})),
    timesheetChatSync: request => unwrap(api.timesheetChatSync(request)),
    openCommands: request => createCommandStream(remote, request),
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
