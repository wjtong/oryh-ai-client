import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DuplicateOperationError, SqliteReceiptStore } from '../src/write-receipts.js'
import { matchWriteOperation } from '../src/write-operations.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const sqlite = await import('node:sqlite')
const receipt = (operationId: string, owner = 'a'.repeat(64), sentAt = 1000) => ({ operationId, owner, kind: 'chat' as const, sessionId: 's', callId: 'c', operation: 'timesheet.create', method: 'POST', path: '/timesheet-headers', digest: 'd'.repeat(64), sentAt })

it('keeps receipts and refuses a used operation id across a reopened database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oryh-receipts-'))
  roots.push(root)
  const path = join(root, 'control', 'receipts.sqlite')
  const first = new SqliteReceiptStore(path, sqlite)
  first.begin(receipt('op-1'))
  first.finish('op-1', { status: 'succeeded', oryhStatus: 201, resourceId: 'th-1' }, 2000)
  first.begin({ ...receipt('op-2', 'b'.repeat(64), 1500), kind: 'page', sessionId: undefined, callId: undefined, confirmedAt: 1400 } as never)
  first.close()
  expect(((await stat(join(root, 'control'))).mode & 0o077)).toBe(0)

  const reopened = new SqliteReceiptStore(path, sqlite)
  expect(reopened.get('op-1')).toEqual({ ...receipt('op-1'), status: 'succeeded', oryhStatus: 201, resourceId: 'th-1', finishedAt: 2000 })
  expect(() => reopened.begin(receipt('op-1'))).toThrow(DuplicateOperationError)
  expect(reopened.list('a'.repeat(64)).map(r => r.operationId)).toEqual(['op-1'])
  expect(reopened.get('op-2')).toMatchObject({ kind: 'page', confirmedAt: 1400, status: 'sent' })
  expect(reopened.get('op-2')).not.toHaveProperty('sessionId')
  reopened.close()
})

it('matches opened operations by method, path, channel and body', () => {
  expect(matchWriteOperation({ method: 'POST', path: '/timesheet-headers/abc/submit?x=1' }, 'chat')?.name).toBe('timesheet.submit')
  expect(matchWriteOperation({ method: 'PATCH', path: '/timesheet-headers/abc/submit' }, 'chat')).toBeUndefined()
  expect(matchWriteOperation({ method: 'POST', path: '/timesheet-headers/a/b/submit' }, 'chat')).toBeUndefined()
  expect(matchWriteOperation({ method: 'POST', path: '/attachments' }, 'page')?.name).toBe('attachment.upload')
  expect(matchWriteOperation({ method: 'POST', path: '/attachments' }, 'chat')).toBeUndefined()
  expect(matchWriteOperation({ method: 'POST', path: '/approval-records', body: { entity_type: 'timesheet_header' } }, 'chat')?.name).toBe('timesheet.approve')
  expect(matchWriteOperation({ method: 'POST', path: '/approval-records', body: { entity_type: 'expense_claim' } }, 'chat')).toBeUndefined()
})
