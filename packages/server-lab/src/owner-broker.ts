/**
 * The control process's side of an owner Host's ORYH access.
 *
 * An owner Host has no ORYH credential. Each business or MCP request it makes arrives here over IPC;
 * this broker checks it against the release's policy, attaches the person's access token from one of
 * their live browser grants, sends it to the pinned ORYH issuer and hands back ORYH's status and body.
 * The token never crosses into the owner Host, so neither it nor anything that Host runs can read it.
 *
 * M1 policy is read-only (docs/33 §3): API reads, the public OpenAPI document, and MCP discovery,
 * skill reads and read-only tool calls. Everything else is refused with a sentence meant for people.
 */
import { OryhClientError, type DelegatedResponse, type OryhRequest } from '@oryh/ai-client-core'

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
  readonly fetch?: typeof fetch
  /** How long a server's read-only tool list is trusted before it is listed again. */
  readonly toolListTtlMs?: number
  readonly now?: () => number
}

const READ_ONLY = '服务器版目前只读，不能保存、提交、审批、创建、修改或删除 ORYH 数据。'
const OUTSIDE = '这个请求不在服务器版开放的范围内。'
const SIGNED_OUT = 'ORYH 登录已结束，请重新登录。'
/** MCP methods that read or describe, and never change anything on the server. */
const MCP_READS = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list', 'prompts/list', 'prompts/get', 'resources/list', 'resources/read', 'resources/templates/list'])
/** GET paths that answer with credential material or mint it. */
const CREDENTIAL_PATHS = [/^\/auth\/(?!me$)/, /^\/my\/skill-bundle/, /api[-_]?keys?/i, /^\/oauth\//]

export class OwnerBroker {
  #readOnlyTools: { names: ReadonlySet<string>; at: number } | undefined
  readonly #now: () => number

  /** The ORYH origin this broker sends to. */
  readonly issuer: string

  constructor(private readonly options: OwnerBrokerOptions) {
    if (new URL(options.issuer).origin !== options.issuer) throw new Error('Broker issuer must be an origin')
    this.issuer = options.issuer
    this.#now = options.now ?? Date.now
  }

  /**
   * Check, authenticate and send one request from the owner Host.
   * @param request - as the owner Host's business runtime built it; untrusted.
   * @param signal - the owner Host's cancellation for this request.
   * @returns ORYH's status and JSON body.
   * @throws OryhClientError with a readable reason when the request is refused or the person has signed out.
   */
  async send(request: OryhRequest, signal: AbortSignal): Promise<DelegatedResponse> {
    const grant = this.options.grants().find(candidate => !candidate.signal.aborted)
    if (!grant) throw new OryhClientError(SIGNED_OUT, 'authentication-failed')
    await this.admit(grant, request, signal)
    return this.forward(grant, request, signal)
  }

  private async admit(grant: BrokerGrant, request: OryhRequest, signal: AbortSignal): Promise<void> {
    const method = request.method ?? 'GET'
    safePath(request.path)
    if (request.root) {
      if (request.path === '/openapi.json' && method === 'GET' && request.body === undefined) return
      if (request.path !== '/mcp' || method !== 'POST') throw refused(OUTSIDE)
      const messages = Array.isArray(request.body) ? request.body : [request.body]
      if (messages.length === 0 || messages.length > 50) throw refused(OUTSIDE)
      for (const message of messages) await this.admitMcp(grant, message, signal)
      return
    }
    if (method !== 'GET' || request.body !== undefined) throw refused(READ_ONLY)
    admitApiRead(request.path)
  }

  private async admitMcp(grant: BrokerGrant, message: unknown, signal: AbortSignal): Promise<void> {
    if (!isObject(message) || typeof message.method !== 'string') throw refused(OUTSIDE)
    if (MCP_READS.has(message.method)) return
    if (message.method !== 'tools/call') throw refused(OUTSIDE)
    const params = isObject(message.params) ? message.params : {}
    const name = params.name
    if (typeof name !== 'string') throw refused(OUTSIDE)
    if (name === 'oryh_request') {
      // The generic tool carries a whole REST call; it is a read only when that call is.
      const args = isObject(params.arguments) ? params.arguments : {}
      const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET'
      if (method !== 'GET' || (args.body !== undefined && args.body !== null)) throw refused(READ_ONLY)
      if (typeof args.path !== 'string' || !args.path.startsWith('/')) throw refused(OUTSIDE)
      safePath(args.path)
      admitApiRead(args.path.replace(/^\/api\/v1(?=\/)/, ''))
      return
    }
    if (!(await this.readOnlyTools(grant, signal)).has(name)) throw refused(READ_ONLY)
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

  private async forward(grant: BrokerGrant, request: OryhRequest, signal: AbortSignal): Promise<DelegatedResponse> {
    const token = await grant.accessToken().catch(() => { throw new OryhClientError(SIGNED_OUT, 'authentication-failed') })
    const url = `${this.options.issuer}${request.root ? '' : '/api/v1'}${request.path}`
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: request.method ?? 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, grant.signal, AbortSignal.timeout(30_000)]),
        headers: {
          authorization: `Bearer ${token}`,
          accept: request.root && request.path === '/mcp' ? 'application/json, text/event-stream' : 'application/json',
          ...request.body === undefined ? {} : { 'content-type': 'application/json' },
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

function admitApiRead(path: string): void {
  const bare = path.split('?')[0]!
  if (CREDENTIAL_PATHS.some(pattern => pattern.test(bare))) throw refused(OUTSIDE)
}
