import type { ConnectionId, DeviceAuthorizationId, OperationId, OperationResultId, SavedOperationId, ExpenseFields } from '@oryh/ai-client-core/types'
export type { BeginConnectionView, ConnectionSummary, ExpenseDraft, ExpenseFields, OryhOperationResult, OperationDefinition, PollConnectionView, SavedOperationView } from '@oryh/ai-client-core'
export interface ConnectRequest { origin: string; clientName: string }
export interface ConnectionRequest { connectionId: ConnectionId }
export interface AuthorizationRequest { authorizationId: DeviceAuthorizationId }
export interface OperationRequest extends ConnectionRequest { operationId: OperationId }
export interface ResultRequest extends OperationRequest { resultId: OperationResultId }
export interface SaveResultRequest extends ResultRequest { label: string }
export interface SavedRequest extends ConnectionRequest { savedOperationId: SavedOperationId }
export interface DraftRequest extends ConnectionRequest { id: string; revision: number }
export interface SaveDraftRequest extends ConnectionRequest { id?: string; revision?: number; fields: ExpenseFields }
export interface ConfirmDraftRequest extends DraftRequest { token: string }
export interface UploadRequest extends ConnectionRequest { filename: string; contentType: string; contentBase64: string }
export interface ExpenseOptions { categories: { name: string; title: string }[] }
export interface AttachmentReceipt { id: string; filename: string; sha256: string }


import type {} from '@deepseek-ai/dsh-typert-protocol'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'oryh/business': { code: string } }
}

export type { TimesheetHeader, TimesheetTodo, TimesheetOptions, TimesheetDetail, TimesheetIntent } from '@oryh/ai-client-timesheets'
export interface TimesheetDetailRequest extends ConnectionRequest { headerId: string; todoId?: string }
export interface TimesheetActionRequest extends ConnectionRequest { action: import('@oryh/ai-client-timesheets').TimesheetAction }

export interface TodoDetailRequest extends ConnectionRequest { todoId: string }
export interface ChatClearRequest { sessionId: string }
export interface ChatSelection { sessionId: string; connectionId: ConnectionId; todoId?: string; timesheetPage?: string; manager?: boolean; homeOnly?: boolean; navigationId?: string; visibleTodos?: {id:string;title:string}[]; listRevision?:string }
export interface ChatContextView { document?:import('@oryh/ai-client-core/types').TodoDocument; ready: boolean; title: string; message: string }
export type { TodoDocument } from '@oryh/ai-client-core/types'

export interface TimesheetChatState {
  sessionId: string; connectionId: ConnectionId; pageKey: string; revision: number
  manager: boolean; headerId?: string; todoId?: string
  localEdits?: string
  navigationId?: string
  fields?: import('@oryh/ai-client-timesheets').TimesheetFields
}
export interface TimesheetChatPoll { sessionId: string; connectionId: ConnectionId; pageKey: string }
export interface TimesheetChatProposal {
  id: string; revision: number; action: import('@oryh/ai-client-timesheets').TimesheetAction
}

export interface ChatHomeRequest { sessionId:string; connectionId:ConnectionId }
export interface ChatNavigation { id:string; expiresAt:number; target?:'todo'|'project'|'page'|'columns'|'filters'; columns?:string[]; queryFields?:string[]; productCode?:string;productIds?:string[];products?:import('@oryh/ai-client-records').ProductOption[]; page?:ChatPageRequest['page']; listRevision?:string; headerId?:string; todoId?:string; manager?:boolean }

export interface ChatPageRequest extends ChatHomeRequest { viewId:string; revision:number; navigationId?:string; page:'my-open-todos'|'my-expense-claims'|'list-projects'|'timesheets'|'timesheet-approvals'|'settings'|import('@oryh/ai-client-records').RecordKind; context?:{key:string;title:string;detail:string;scope:string;content?:string;queryFields?:string[];productCode?:string;productIds?:string[];products?:import('@oryh/ai-client-records').ProductOption[];columns?:string[];availableColumns?:{id:string;label:string}[]} }

export type {ProjectFields,ProjectIntent,ProjectOptions} from '@oryh/ai-client-core/types'
export interface ProjectPrepareRequest extends ConnectionRequest {fields:import('@oryh/ai-client-core/types').ProjectFields}
export interface ProjectChatState extends ChatHomeRequest {pageKey:string;revision:number;navigationId?:string;fields:import('@oryh/ai-client-core/types').ProjectFields;busy:boolean}
export interface ProjectChatProposal {id:string;revision:number;fields:import('@oryh/ai-client-core/types').ProjectFields}

export type ProjectColumn='name'|'code'|'status'|'client'|'startDate'|'endDate'|'createdAt'|'updatedAt'

/** Every page command pending for one session. The Host republishes the whole set on each change. */
export interface CommandSnapshot {
  /** Navigation, column, filter, todo, project-open and timesheet-open commands share one slot. */
  navigation?: ChatNavigation
  /** Staged timesheet suggestion for the bound timesheet page. */
  timesheet?: TimesheetChatProposal
  /** Staged new-project field suggestion. */
  project?: ProjectChatProposal
}

/** Opening frame of one stream generation, carrying the full pending set. */
export interface CommandBaseline { type:'baseline'; commands:CommandSnapshot }
/** Later frame; also the full set, so a consumer never replays deltas. */
export interface CommandUpdate { type:'update'; commands:CommandSnapshot }
/** Stream frame: exactly one `baseline` per generation, then `update`s. */
export type CommandFrame = CommandBaseline | CommandUpdate
