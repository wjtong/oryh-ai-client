/**
 * The ORYH writes the server lets through, and what each is called (docs/34 §6).
 *
 * A write reaches ORYH only if it matches an entry here: its method, its path under `/api/v1`, and —
 * where one endpoint serves several business actions — its body. Anything unmatched is refused with
 * a sentence saying the server has not opened that operation yet. The list grows as skills are
 * verified against real ORYH, one operation at a time.
 */
import type { OryhOperation } from '@oryh/ai-client-core'

export interface WriteOperation {
  /** Stable name for receipts and logs. */
  readonly name: string
  /** What a person reads in a refusal or a receipt. */
  readonly label: string
  readonly method: 'POST' | 'PATCH' | 'DELETE'
  /** Matched against the path without its query string, under `/api/v1`. */
  readonly path: RegExp
  /** Which kinds of write may use this operation. */
  readonly channels: readonly OryhOperation['kind'][]
  /** Further restriction by body, for endpoints shared by several actions. */
  readonly accepts?: (body: unknown) => boolean
}

const ID = '[^/?#]+'
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export const WRITE_OPERATIONS: readonly WriteOperation[] = [
  { name: 'timesheet.create', label: '新建工时单', method: 'POST', path: /^\/timesheet-headers$/, channels: ['page', 'chat'] },
  { name: 'timesheet.save', label: '保存工时单', method: 'POST', path: new RegExp(`^/timesheet-headers/${ID}/save$`), channels: ['page', 'chat'] },
  { name: 'timesheet.submit', label: '提交工时单', method: 'POST', path: new RegExp(`^/timesheet-headers/${ID}/submit$`), channels: ['page', 'chat'] },
  { name: 'timesheet-entry.create', label: '新增工时明细', method: 'POST', path: /^\/timesheet-entries$/, channels: ['page', 'chat'] },
  { name: 'timesheet-entry.update', label: '修改工时明细', method: 'PATCH', path: new RegExp(`^/timesheet-entries/${ID}$`), channels: ['page', 'chat'] },
  { name: 'timesheet-entry.delete', label: '删除工时明细', method: 'DELETE', path: new RegExp(`^/timesheet-entries/${ID}$`), channels: ['page', 'chat'] },
  {
    name: 'timesheet.approve', label: '审批工时单', method: 'POST', path: /^\/approval-records$/, channels: ['page', 'chat'],
    accepts: body => isObject(body) && body.entity_type === 'timesheet_header',
  },
  { name: 'expense.create', label: '新建费用单', method: 'POST', path: /^\/expense-claims$/, channels: ['page', 'chat'] },
  { name: 'expense.submit', label: '提交费用单', method: 'POST', path: new RegExp(`^/expense-claims/${ID}/submit$`), channels: ['page', 'chat'] },
  // Only a page upload: its content is the file the person chose. A model-supplied file cannot be checked by anyone.
  { name: 'attachment.upload', label: '上传附件', method: 'POST', path: /^\/attachments$/, channels: ['page'] },
  { name: 'project.create', label: '新建项目', method: 'POST', path: /^\/projects$/, channels: ['page', 'chat'] },
]

/**
 * The opened operation a write request is, if any.
 * @param request - method, path under `/api/v1` (a query string is ignored for matching) and body.
 * @param kind - whether a page or a chat session is writing.
 * @returns the operation, or undefined when this write is not opened for that kind.
 */
export function matchWriteOperation(request: { method: string; path: string; body?: unknown }, kind: OryhOperation['kind']): WriteOperation | undefined {
  const bare = request.path.split('?')[0]!
  return WRITE_OPERATIONS.find(operation => operation.method === request.method && operation.path.test(bare)
    && operation.channels.includes(kind) && (operation.accepts?.(request.body) ?? true))
}
