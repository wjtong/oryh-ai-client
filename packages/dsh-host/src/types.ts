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
