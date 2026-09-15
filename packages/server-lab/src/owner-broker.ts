/**
 * The control process's side of an owner Host's ORYH access.
 *
 * An owner Host has no ORYH credential. Each business or MCP request it makes arrives here over IPC;
 * this broker checks it against the release's policy, attaches the person's access token from one of
 * their live browser grants, sends it to the pinned ORYH issuer and hands back ORYH's status and body.
 * The token never crosses into the owner Host, so neither it nor anything that Host runs can read it.
 *
 * Reads (docs/33 §3): API reads, the public OpenAPI document, validation runs, MCP discovery, skill
 * reads and read-only tool calls.
 *
 * Writes (docs/34 §4.2), only when a receipt store is configured: each must carry the operation the
 * Host attached — a page write the digest and time of the person's confirmation, a chat write its
 * session and tool call — match an opened operation, and use an operation id never seen before. A
 * receipt is recorded before the request leaves and settled from ORYH's answer, and the operation id
 * travels as ORYH's idempotency key. Everything refused is refused with a sentence meant for people.
 */
import { OryhClientError, operationDigest, type DelegatedResponse, type OryhOperation, type OryhRequest } from '@oryh/ai-client-core'
import { matchWriteOperation, type WriteOperation } from './write-operations.js'
import { DuplicateOperationError, type ReceiptOutcome, type ReceiptStore } from './write-receipts.js'

/** One live authorization this broker may send under. */
export interface BrokerGrant {
  readonly signal: AbortSignal
  accessToken(): Promise<string>
}

export interface OwnerBrokerOptions {
  /** Pinned ORYH origin; requests never go anywhere else. */
  readonly issuer: string
  /** The owner's live grants, newest first; the broker uses the first one still active. */
  readonly grants: () => readonly BrokerGrant[]
  /** Owner hash, recorded on receipts. Required with `receipts`. */
  readonly owner?: string
  /** Where write receipts go. Without one the broker is read-only. */
  readonly receipts?: ReceiptStore
  readonly fetch?: typeof fetch
  /** How long a server's read-only tool list is trusted before it is listed again. */
  readonly toolListTtlMs?: number
  /** How long a page confirmation stays valid; default five minutes. */
  readonly confirmationTtlMs?: number
  readonly now?: () => number
  /** Report refusals, non-2xx answers and write outcomes — method, path and status only, never a token or a body. */
  readonly log?: (line: string) => void
}

const READ_ONLY = '服务器版目前只读，不能保存、提交、审批、创建、修改或删除 ORYH 数据。'
const OUTSIDE = '这个请求不在服务器版开放的范围内。'
const SIGNED_OUT = 'ORYH 登录已结束，请重新登录。'
const NOT_OPENED = '服务器版暂未开放这项写入。'
const NO_OPERATION = '这次写入缺少服务器要求的写入描述，未发送。'
const CHANGED = '写入内容与确认时不一致，未发送。请重新核对后再确认。'
const EXPIRED = '确认已过期，未发送。请重新核对后再确认。'
const DUPLICATE = '这笔写入已经发送过，不会重复发送。请先核对单据状态。'
const UNKNOWN_RESULT = '写入结果不明：没有收到 ORYH 的应答。请先核对单据状态，不要重复写入。'
/** ORYH answers that mean the write was refused and nothing was written. */
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 409, 422])
/** MCP methods that read or describe, and never change anything on the server. */
const MCP_READS = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list', 'prompts/list', 'prompts/get', 'resources/list', 'resources/read', 'resources/templates/list'])
/**
 * ORYH's MCP tools that only read, by name. ORYH does not annotate its tools, so annotations alone
 * would refuse every read; a tool it adds later is refused until it is judged and listed here, unless
 * ORYH marks it read-only itself.
 */
const READ_TOOLS = new Set(['oryh_list', 'oryh_get', 'oryh_detail', 'builtin_object_types', 'object_directory', 'setup_report'])
/** GET paths that answer with credential material or mint it. */
const CREDENTIAL_PATHS = [/^\/auth\/(?!me$)/, /^\/my\/skill-bundle/, /api[-_]?keys?/i, /^\/oauth\//]

/** A write as the broker understands it: the REST call it is, whichever way it arrived. */
interface WriteCall {
  readonly channel: OryhOperation['kind']
  readonly method: string
  /** Under `/api/v1`, as it will reach ORYH. */
  readonly path: string
  readonly body?: unknown
  /** For a chat write, the index of the tools/call message within the MCP request. */
  readonly message?: number
}

export class OwnerBroker {
  #readOnlyTools: { names: ReadonlySet<string>; at: number } | undefined
  readonly #now: () => number

  /** The ORYH origin this broker sends to. */
  readonly issuer: string

  constructor(private readonly options: OwnerBrokerOptions) {
    if (new URL(options.issuer).origin !== options.issuer) throw new Error('Broker issuer must be an origin')
    if (options.receipts && !options.owner) throw new Error('A broker that writes needs its owner')
    this.issuer = options.issuer
    this.#now = options.now ?? Date.now
  }

  /**
   * Check, authenticate and send one request from the owner Host.
   * @param request - as the owner Host's business runtime built it; untrusted.
   * @param signal - the owner Host's cancellation for this request.
   * @returns ORYH's status and JSON body.
   * @throws OryhClientError with a readable reason when the request is refused, the person has signed out,
   *   or a write's result could not be learned.
   */
  async send(request: OryhRequest, signal: AbortSignal): Promise<DelegatedResponse> {
    const label = `${request.method ?? 'GET'} ${request.root ? '' : '/api/v1'}${request.path.split('?')[0]}${describeMcp(request)}`
    const log = (line: string) => this.options.log?.(`broker: ${label} ${line}`)
    const grant = this.options.grants().find(candidate => !candidate.signal.aborted)
    if (!grant) { log('refused: no live grant'); throw new OryhClientError(SIGNED_OUT, 'authentication-failed') }
    let write: { call: WriteCall; operation: WriteOperation; description: OryhOperation } | undefined
    try {
      const call = await this.classify(grant, request, signal)
      if (call) write = this.admitWrite(request, call)
    } catch (error) {
      log(`refused: ${error instanceof Error ? error.message : 'policy'}`)
      throw error
    }
    if (!write) {
      const answer = await this.forward(grant, request, signal).catch(error => { log(`failed: ${error instanceof Error ? error.message : 'transport'}`); throw error })
      if (answer.status < 200 || answer.status >= 300) log(`answered ${answer.status}`)
      return answer
    }
    const { call, operation, description } = write
    const receipts = this.options.receipts!
    let answer: DelegatedResponse
    try {
      answer = await this.forward(grant, withIdempotencyKey(request, call, description.operationId), signal)
    } catch {
      receipts.finish(description.operationId, { status: 'unknown' }, this.#now())
      log(`write ${operation.name} ${description.operationId}: unknown (no answer)`)
      throw new OryhClientError(UNKNOWN_RESULT, 'request-failed')
    }
    const outcome = settle(call, answer)
    receipts.finish(description.operationId, outcome, this.#now())
    log(`write ${operation.name} ${description.operationId}: ${outcome.status}${outcome.oryhStatus ? ` (${outcome.oryhStatus})` : ''}`)
    return answer
  }

  /**
   * Decide whether a request only reads, refusing what is neither a read nor a write this release
   * could open.
   * @returns the write it is, or undefined for a read.
   */
  private async classify(grant: BrokerGrant, request: OryhRequest, signal: AbortSignal): Promise<WriteCall | undefined> {
    const method = request.method ?? 'GET'
    safePath(request.path)
    if (request.root) {
      if (request.path === '/openapi.json' && method === 'GET' && request.body === undefined) return undefined
      if (request.path !== '/mcp' || method !== 'POST') throw refused(OUTSIDE)
      const messages = Array.isArray(request.body) ? request.body : [request.body]
      if (messages.length === 0 || messages.length > 50) throw refused(OUTSIDE)
      let write: WriteCall | undefined
      for (const [index, message] of messages.entries()) {
        const call = await this.classifyMcp(grant, message, signal)
        if (!call) continue
        // One write per request, so one receipt and one idempotency key describe it.
        if (messages.length !== 1) throw refused(OUTSIDE)
        write = { ...call, message: index }
      }
      return write
    }
    admitApiRead(request.path)
    if (method === 'GET' && request.body === undefined) return undefined
    if (['POST', 'PATCH'].includes(method) && validationOnly(request.path)) return undefined
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw refused(OUTSIDE)
    return { channel: 'page', method, path: request.path, ...request.body === undefined ? {} : { body: request.body } }
  }

  private async classifyMcp(grant: BrokerGrant, message: unknown, signal: AbortSignal): Promise<Omit<WriteCall, 'message'> | undefined> {
    if (!isObject(message) || typeof message.method !== 'string') throw refused(OUTSIDE)
    if (MCP_READS.has(message.method)) return undefined
    if (message.method !== 'tools/call') throw refused(OUTSIDE)
    const params = isObject(message.params) ? message.params : {}
    const name = params.name
    if (typeof name !== 'string') throw refused(OUTSIDE)
    if (name === 'oryh_request') {
      // The generic tool carries a whole REST call; it is a read only when that call is.
      const args = isObject(params.arguments) ? params.arguments : {}
      const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET'
      if (typeof args.path !== 'string') throw refused(OUTSIDE)
      const path = args.path.startsWith('/') ? args.path : `/${args.path}`
      safePath(path)
      const api = path.replace(/^\/api\/v1(?=\/|$)/, '') || '/'
      admitApiRead(api)
      const hasBody = args.body !== undefined && args.body !== null
      if (method === 'GET' && !hasBody) return undefined
      // The agent checks a draft the same way the page does, but may pass the flag in the tool's own
      // `query` object instead of the path; that is still a validation run, not a create.
      if (['POST', 'PATCH'].includes(method) && validationOnly(path, args.query)) return undefined
      if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw refused(this.options.receipts ? NOT_OPENED : READ_ONLY)
      return { channel: 'chat', method, path: api, ...hasBody ? { body: args.body } : {} }
    }
    if (READ_TOOLS.has(name)) return undefined
    if ((await this.readOnlyTools(grant, signal)).has(name)) return undefined
    // Any other tool (upload_attachment, or one ORYH adds later) writes in a way no operation describes.
    throw refused(this.options.receipts ? NOT_OPENED : READ_ONLY)
  }

  /** Admit a write and record its receipt, or refuse it before anything is sent. */
  private admitWrite(request: OryhRequest, call: WriteCall) {
    const receipts = this.options.receipts
    if (!receipts) throw refused(READ_ONLY)
    const description = request.operation
    if (!description) throw refused(NO_OPERATION)
    // A page confirms the REST call it shows; a chat session writes through ORYH's tools.
    if (description.kind !== call.channel) throw refused(OUTSIDE)
    const now = this.#now()
    if (description.kind === 'page') {
      if (operationDigest({ method: call.method, path: request.path, body: request.body }) !== description.digest) throw refused(CHANGED)
      const ttl = this.options.confirmationTtlMs ?? 300_000
      if (description.confirmedAt > now + 60_000 || now - description.confirmedAt > ttl) throw refused(EXPIRED)
    }
    const operation = matchWriteOperation(call, description.kind)
    if (!operation) throw refused(NOT_OPENED)
    try {
      receipts.begin({
        operationId: description.operationId,
        owner: this.options.owner!,
        kind: description.kind,
        operation: operation.name,
        method: call.method,
        path: call.path.split('?')[0]!,
        digest: operationDigest(call),
        sentAt: now,
        ...description.kind === 'page' ? { confirmedAt: description.confirmedAt } : { sessionId: description.sessionId, callId: description.callId },
      })
    } catch (error) {
      if (error instanceof DuplicateOperationError) throw refused(DUPLICATE)
      throw error
    }
    return { call, operation, description }
  }

  /** Which tools ORYH itself marks read-only, asked of ORYH rather than of the owner Host. */
  private async readOnlyTools(grant: BrokerGrant, signal: AbortSignal): Promise<ReadonlySet<string>> {
    const cached = this.#readOnlyTools
    if (cached && this.#now() - cached.at < (this.options.toolListTtlMs ?? 300_000)) return cached.names
    const names = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const answer = await this.forward(grant, { path: '/mcp', root: true, method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: cursor ? { cursor } : {} } }, signal)
      const result = isObject(answer.body) && isObject(answer.body.result) ? answer.body.result : undefined
      if (answer.status !== 200 || !result || !Array.isArray(result.tools)) throw refused(OUTSIDE)
      for (const tool of result.tools) {
        if (isObject(tool) && typeof tool.name === 'string' && isObject(tool.annotations) && tool.annotations.readOnlyHint === true) names.add(tool.name)
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
      if (!cursor) break
    }
    // oryh_request is judged per call, never by its annotation.
    names.delete('oryh_request')
    this.#readOnlyTools = { names, at: this.#now() }
    return names
  }

  private async forward(grant: BrokerGrant, request: OryhRequest & { idempotencyKey?: string }, signal: AbortSignal): Promise<DelegatedResponse> {
    const token = await grant.accessToken().catch(() => { throw new OryhClientError(SIGNED_OUT, 'authentication-failed') })
    const url = `${this.options.issuer}${request.root ? '' : '/api/v1'}${request.path}`
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: request.method ?? 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, grant.signal, AbortSignal.timeout(30_000)]),
        // The OAuth access token is ORYH's interactive API key. Sent as X-API-Key, as the desktop client
        // does: every ORYH endpoint accepts it, while a person's self-service endpoints (the skills
        // manifest) accept nothing else. ORYH's MCP endpoint always answers JSON.
        headers: {
          'x-api-key': token,
          accept: 'application/json',
          ...request.body === undefined ? {} : { 'content-type': 'application/json' },
          ...request.idempotencyKey ? { 'idempotency-key': request.idempotencyKey } : {},
        },
        ...request.body === undefined ? {} : { body: JSON.stringify(request.body) },
      })
    } catch {
      throw new OryhClientError('暂时无法连接 ORYH，请稍后重试。', 'request-failed')
    }
    const text = await response.text()
    let body: unknown = null
    if (text) {
      try { body = JSON.parse(text) } catch { body = null }
    }
    return { status: response.status, body }
  }
}

/**
 * The request as it leaves, with the operation id as ORYH's idempotency key: a header on a REST call,
 * the tool's `idempotency_key` argument on a chat write. An ORYH without idempotency ignores both.
 */
function withIdempotencyKey(request: OryhRequest, call: WriteCall, operationId: string): OryhRequest & { idempotencyKey?: string } {
  if (call.channel === 'page') return { ...request, idempotencyKey: operationId }
  const messages = structuredClone(Array.isArray(request.body) ? request.body : [request.body]) as Record<string, Record<string, Record<string, unknown>>>[]
  const params = messages[call.message ?? 0]!.params!
  params.arguments = { ...params.arguments, idempotency_key: operationId }
  return { ...request, body: Array.isArray(request.body) ? messages : messages[0] }
}

/** What ORYH's answer means for a write: written, refused, or not knowable. */
function settle(call: WriteCall, answer: DelegatedResponse): ReceiptOutcome {
  const resourceIdOf = (value: unknown) => {
    const data = isObject(value) && isObject(value.data) ? value.data : undefined
    return typeof data?.id === 'string' && data.id ? { resourceId: data.id } : {}
  }
  if (call.channel === 'page') {
    if (answer.status >= 200 && answer.status < 300) return { status: 'succeeded', oryhStatus: answer.status, ...resourceIdOf(answer.body) }
    return { status: REJECTED_STATUSES.has(answer.status) ? 'rejected' : 'unknown', oryhStatus: answer.status }
  }
  if (answer.status !== 200) return { status: REJECTED_STATUSES.has(answer.status) ? 'rejected' : 'unknown', oryhStatus: answer.status }
  const replies = Array.isArray(answer.body) ? answer.body : [answer.body]
  const reply = replies[call.message ?? 0]
  if (!isObject(reply)) return { status: 'unknown' }
  // A JSON-RPC error means the tool never ran.
  if (reply.error !== undefined) return { status: 'rejected' }
  const result = isObject(reply.result) ? reply.result : {}
  if (result.isError !== true) return { status: 'succeeded', ...resourceIdOf(result.structuredContent) }
  // ORYH marks every HTTP error as a tool error; a 4xx carries the API's own `detail`, a server failure does not.
  const structured = isObject(result.structuredContent) ? result.structuredContent : undefined
  return { status: structured && structured.detail !== undefined ? 'rejected' : 'unknown' }
}

/** The MCP methods (and tool names) in a request, for a log line. */
function describeMcp(request: OryhRequest): string {
  if (!request.root || request.path !== '/mcp') return ''
  const messages = (Array.isArray(request.body) ? request.body : [request.body]).filter(isObject)
  return ` [${messages.map(m => m.method === 'tools/call' && isObject(m.params) ? `tools/call:${String(m.params.name)}` : String(m.method)).join(',')}]`
}

function refused(message: string): OryhClientError {
  return new OryhClientError(message, 'request-failed')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A path that stays on the API it names: no scheme or authority, traversal, or encoded separators. */
function safePath(path: string): void {
  const bare = path.split('?')[0]!
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#\s]/.test(path) || /%(2e|2f|5c)/i.test(bare) || bare.split('/').some(segment => segment === '..' || segment === '.')) {
    throw refused(OUTSIDE)
  }
}

/**
 * Whether a POST or PATCH only validates: every `validate_only` it carries is `true`, and it carries at
 * least one. A validation run (a draft checked before it is saved) writes nothing. ORYH refuses query
 * parameters an operation does not declare, so an endpoint without validate_only answers 422 rather
 * than treating the request as a write. Any other value, or a conflicting pair, counts as a write.
 * @param path - the path as sent, with its query string if any.
 * @param query - the query object of ORYH's generic tool, if the call came through it.
 */
function validationOnly(path: string, query?: unknown): boolean {
  const values = new URLSearchParams(path.split('?')[1] ?? '').getAll('validate_only')
  if (isObject(query) && query.validate_only !== undefined) {
    values.push(...(Array.isArray(query.validate_only) ? query.validate_only : [query.validate_only]).map(String))
  }
  return values.length > 0 && values.every(value => value === 'true')
}

function admitApiRead(path: string): void {
  const bare = path.split('?')[0]!
  if (CREDENTIAL_PATHS.some(pattern => pattern.test(bare))) throw refused(OUTSIDE)
}
