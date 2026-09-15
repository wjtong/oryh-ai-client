/**
 * Batch B acceptance (docs/34 §8): a page write the person confirmed passes the broker once, with a
 * receipt; a second confirmation or a replay never reaches ORYH. The server business runtime is
 * connected straight to the broker here — the IPC link between them is covered in core.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerOryhRuntime, type OryhRequest } from '@oryh/ai-client-core'
import { OwnerBroker } from '../src/owner-broker.js'
import { MemoryReceiptStore } from '../src/write-receipts.js'

const owner = 'a'.repeat(64)
const identity = { user: { id: 'u-a', email: 'a@example.test', name: 'A', role: 'member', employeeId: 'e-a' }, tenant: { id: 't-a', slug: 'a', name: 'A', environmentId: null },
  permissions: ['timesheet.submit_own', 'expense.submit_own', 'master_data.manage'] }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function setup() {
  const writes: { method: string; path: string; key: string | undefined }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET', path = url.pathname.replace('/api/v1', '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (method !== 'GET' && !url.searchParams.has('validate_only')) writes.push({ method, path, key: headers['idempotency-key'] })
    if (path === '/auth/me') return Response.json({ data: { id: 'u-a', email: 'a@example.test', name: 'A', role: 'member', employee_id: 'e-a', tenant_id: 't-a', tenant: { slug: 'a', name: 'A' }, permissions: identity.permissions } })
    if (url.searchParams.get('validate_only') === 'true') return Response.json({ data: {}, meta: { validate_only: true, written: false } })
    if (method === 'POST' && path === '/timesheet-headers') return Response.json({ data: { id: 'th-1' } }, { status: 201 })
    if (method === 'POST' && path === '/projects') return Response.json({ data: { id: 'p-1', ...body, client: body.client ?? '', start_date: body.start_date ?? '', end_date: body.end_date ?? '' } }, { status: 201 })
    if (method === 'POST' && path === '/expense-claims') return Response.json({ data: { id: 'ec-1', status: 'draft', employee_id: 'e-a', submitted_at: null } }, { status: 201 })
    if (method === 'POST' && path === '/attachments') return Response.json({ data: { id: 'att-1', filename: body.filename, content_type: body.content_type, sha256: '', size: 3 } }, { status: 201 })
    return Response.json({ data: [], meta: { pages: 1 } })
  }) as typeof globalThis.fetch
  const receipts = new MemoryReceiptStore()
  const broker = new OwnerBroker({ issuer: 'https://oryh.example.test', owner, receipts, fetch, grants: () => [{ signal: new AbortController().signal, accessToken: async () => 'token' }] })
  const sent: OryhRequest[] = []
  const root = await mkdtemp(join(tmpdir(), 'oryh-page-writes-'))
  roots.push(root)
  const runtime = createServerOryhRuntime({
    binding: { origin: 'https://oryh.example.test', identity, signal: new AbortController().signal, send: (request, signal) => { sent.push(request); return broker.send(request, signal) } },
    dataDirectory: join(root, 'data'), agentsHome: join(root, 'agents'), storeSecret: Buffer.alloc(32, 3),
  })
  const [connection] = await runtime.controller.listConnections()
  return { runtime, broker, receipts, writes, sent, id: connection!.id }
}

describe('page writes on the server', () => {
  it('sends a confirmed timesheet once; confirming again or replaying never reaches ORYH', async () => {
    const f = await setup()
    const fields = { period_start: '2026-09-07', period_end: '2026-09-11', source_report_text: '本周工时', entries: [{ work_date: '2026-09-08', hours: 8, work_type: 'regular', project_id: '', task: '开发', notes: '' }] }
    const intent = await f.runtime.timesheets.timesheetPrepare(f.id, { kind: 'create', fields })
    const done = await f.runtime.timesheets.timesheetConfirm(f.id, intent.id, intent.revision, intent.token!)
    expect(done.state).toBe('done')
    expect(f.writes).toEqual([{ method: 'POST', path: '/timesheet-headers', key: intent.id }])
    expect(f.receipts.get(intent.id)).toMatchObject({ kind: 'page', operation: 'timesheet.create', status: 'succeeded', resourceId: 'th-1' })

    await expect(f.runtime.timesheets.timesheetConfirm(f.id, intent.id, intent.revision, intent.token!)).rejects.toThrow()
    const write = f.sent.find(r => r.operation)!
    await expect(f.broker.send(write, new AbortController().signal)).rejects.toThrow('已经发送过')
    expect(f.writes).toHaveLength(1)
  })

  it('gives an expense draft\'s create its own operation, and records an upload', async () => {
    const f = await setup()
    // The stand-in's attachment answer is minimal; what matters here is that the upload was admitted and recorded.
    await f.runtime.expenses.expenseUpload(f.id, { filename: 'receipt.pdf', contentType: 'application/pdf', contentBase64: 'JVBE' }).catch(() => undefined)
    expect(f.receipts.list(owner).find(r => r.operation === 'attachment.upload')).toMatchObject({ kind: 'page', status: 'succeeded' })
    const draft = await f.runtime.expenses.expenseSave(f.id, { fields: { title: '差旅', claimDate: '2026-09-10', currency: 'CNY', items: [{ expenseDate: '2026-09-09', category: 'travel', amount: '120', merchant: '', invoiceNumber: '', notes: '' }] } })
    const review = await f.runtime.expenses.expensePrepare(f.id, draft.id, draft.revision)
    const created = await f.runtime.expenses.expenseConfirm(f.id, review.id, review.revision, review.confirmation!.token)
    expect(created.state).toBe('created')
    const receipt = f.receipts.list(owner).find(r => r.operation === 'expense.create')!
    expect(receipt).toMatchObject({ status: 'succeeded', resourceId: 'ec-1' })
    expect(receipt.operationId).toBe(`${draft.id}:create:${review.revision + 1}`)
  })

  it('creates a confirmed project through the broker', async () => {
    const f = await setup()
    const intent = await f.runtime.projects.projectPrepare(f.id, { project_name: '新项目', project_code: 'P-001', client: '', start_date: '', end_date: '' })
    const created = await f.runtime.projects.projectConfirm(f.id, intent.id, intent.revision, intent.token)
    expect(created.state).toBe('created')
    expect(f.receipts.get(`${intent.id}:create`)).toMatchObject({ operation: 'project.create', status: 'succeeded', resourceId: 'p-1' })
  })
})
