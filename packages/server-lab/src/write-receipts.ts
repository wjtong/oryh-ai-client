/**
 * Receipts for the writes the control process sent to ORYH (docs/34 §4.5).
 *
 * A receipt is written before the request leaves and updated when ORYH answers, so a write whose
 * answer never came is still on record as `unknown`. The operation id is the primary key: a second
 * attempt to send the same operation is refused by the store itself, which is what keeps one
 * confirmation or tool call from reaching ORYH twice, across restarts too. Bodies are never stored —
 * a digest identifies what was sent, and ORYH's resource id says what it became.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type ReceiptStatus = 'sent' | 'succeeded' | 'rejected' | 'unknown'

export interface WriteReceipt {
  readonly operationId: string
  readonly owner: string
  readonly kind: 'page' | 'chat'
  readonly sessionId?: string
  readonly callId?: string
  readonly operation: string
  readonly method: string
  /** Path without its query string. */
  readonly path: string
  readonly digest: string
  readonly status: ReceiptStatus
  readonly oryhStatus?: number
  readonly resourceId?: string
  readonly confirmedAt?: number
  readonly sentAt: number
  readonly finishedAt?: number
}

export interface ReceiptOutcome {
  readonly status: Exclude<ReceiptStatus, 'sent'>
  readonly oryhStatus?: number
  readonly resourceId?: string
}

/** Thrown when an operation id has already been used; nothing is sent. */
export class DuplicateOperationError extends Error {
  constructor(operationId: string) { super(`operation ${operationId} was already sent`) }
}

export interface ReceiptStore {
  /** Record a write about to be sent; throws DuplicateOperationError when its id was used before. */
  begin(receipt: Omit<WriteReceipt, 'status' | 'finishedAt'>): void
  /** Record ORYH's answer, or that none came. */
  finish(operationId: string, outcome: ReceiptOutcome, finishedAt?: number): void
  get(operationId: string): WriteReceipt | undefined
  /** One owner's receipts, newest first. */
  list(owner: string, limit?: number): WriteReceipt[]
  close(): void
}

/** For tests and a server without a data root. Receipts end with the process. */
export class MemoryReceiptStore implements ReceiptStore {
  readonly #receipts = new Map<string, WriteReceipt>()
  begin(receipt: Omit<WriteReceipt, 'status' | 'finishedAt'>): void {
    if (this.#receipts.has(receipt.operationId)) throw new DuplicateOperationError(receipt.operationId)
    this.#receipts.set(receipt.operationId, { ...receipt, status: 'sent' })
  }
  finish(operationId: string, outcome: ReceiptOutcome, finishedAt = Date.now()): void {
    const current = this.#receipts.get(operationId)
    if (current) this.#receipts.set(operationId, { ...current, ...outcome, finishedAt })
  }
  get(operationId: string): WriteReceipt | undefined { return this.#receipts.get(operationId) }
  list(owner: string, limit = 100): WriteReceipt[] {
    return [...this.#receipts.values()].filter(r => r.owner === owner).sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  }
  close(): void {}
}

interface Row {
  operation_id: string; owner: string; kind: string; session_id: string | null; call_id: string | null
  operation: string; method: string; path: string; digest: string; status: string
  oryh_status: number | null; resource_id: string | null; confirmed_at: number | null; sent_at: number; finished_at: number | null
}

/** SQLite on the data volume, through Node's built-in `node:sqlite`. */
export class SqliteReceiptStore implements ReceiptStore {
  readonly #db: import('node:sqlite').DatabaseSync
  readonly #insert: import('node:sqlite').StatementSync
  readonly #update: import('node:sqlite').StatementSync
  readonly #select: import('node:sqlite').StatementSync
  readonly #list: import('node:sqlite').StatementSync

  /**
   * @param path - database file; its directory is created private to this process's user.
   * @param sqlite - the `node:sqlite` module, loaded by the caller so its experimental warning is theirs to handle.
   */
  constructor(path: string, sqlite: typeof import('node:sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.#db = new sqlite.DatabaseSync(path)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS write_receipts (
        operation_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('page', 'chat')),
        session_id TEXT,
        call_id TEXT,
        operation TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('sent', 'succeeded', 'rejected', 'unknown')),
        oryh_status INTEGER,
        resource_id TEXT,
        confirmed_at INTEGER,
        sent_at INTEGER NOT NULL,
        finished_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS write_receipts_owner ON write_receipts (owner, sent_at DESC);
    `)
    this.#insert = this.#db.prepare(`INSERT INTO write_receipts (operation_id, owner, kind, session_id, call_id, operation, method, path, digest, status, confirmed_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`)
    this.#update = this.#db.prepare('UPDATE write_receipts SET status = ?, oryh_status = ?, resource_id = ?, finished_at = ? WHERE operation_id = ?')
    this.#select = this.#db.prepare('SELECT * FROM write_receipts WHERE operation_id = ?')
    this.#list = this.#db.prepare('SELECT * FROM write_receipts WHERE owner = ? ORDER BY sent_at DESC LIMIT ?')
  }

  begin(receipt: Omit<WriteReceipt, 'status' | 'finishedAt'>): void {
    try {
      this.#insert.run(receipt.operationId, receipt.owner, receipt.kind, receipt.sessionId ?? null, receipt.callId ?? null, receipt.operation,
        receipt.method, receipt.path, receipt.digest, receipt.confirmedAt ?? null, receipt.sentAt)
    } catch (error) {
      // SQLITE_CONSTRAINT_PRIMARYKEY: the operation id was used before.
      if ((error as { errcode?: number }).errcode === 1555) throw new DuplicateOperationError(receipt.operationId)
      throw error
    }
  }

  finish(operationId: string, outcome: ReceiptOutcome, finishedAt = Date.now()): void {
    this.#update.run(outcome.status, outcome.oryhStatus ?? null, outcome.resourceId ?? null, finishedAt, operationId)
  }

  get(operationId: string): WriteReceipt | undefined {
    const row = this.#select.get(operationId) as Row | undefined
    return row ? fromRow(row) : undefined
  }

  list(owner: string, limit = 100): WriteReceipt[] {
    return (this.#list.all(owner, limit) as unknown as Row[]).map(fromRow)
  }

  close(): void { this.#db.close() }
}

function fromRow(row: Row): WriteReceipt {
  return {
    operationId: row.operation_id, owner: row.owner, kind: row.kind as WriteReceipt['kind'], operation: row.operation,
    method: row.method, path: row.path, digest: row.digest, status: row.status as ReceiptStatus, sentAt: row.sent_at,
    ...row.session_id !== null ? { sessionId: row.session_id } : {},
    ...row.call_id !== null ? { callId: row.call_id } : {},
    ...row.oryh_status !== null ? { oryhStatus: row.oryh_status } : {},
    ...row.resource_id !== null ? { resourceId: row.resource_id } : {},
    ...row.confirmed_at !== null ? { confirmedAt: row.confirmed_at } : {},
    ...row.finished_at !== null ? { finishedAt: row.finished_at } : {},
  }
}
