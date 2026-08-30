import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  connectionId,
  deviceAuthorizationId,
  operationResultId,
  savedOperationId,
  type OryhClientError,
  type OryhClientRemote,
  type OperationId,
} from '@oryh/ai-client-core'

const MAX_JSON_BYTES = 1024 * 1024

/** Options constraining the browser-to-Host loopback API. */
export interface OryhApiHandlerOptions {
  readonly expectedOrigin: string
}

/** Serve the browser-safe ORYH Remote over narrow, same-origin JSON routes. */
export function createOryhApiHandler(
  remote: OryhClientRemote,
  options: OryhApiHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    try {
      assertSameOrigin(request, options.expectedOrigin)
      const url = new URL(request.url ?? '/', options.expectedOrigin)
      const result = await route(remote, request, url)
      sendJson(response, 200, { data: result ?? null })
    } catch (error) {
      sendError(response, error)
    }
  }
}

async function route(remote: OryhClientRemote, request: IncomingMessage, url: URL): Promise<unknown> {
  const method = request.method ?? 'GET'
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'api' || segments[1] !== 'client') throw new RequestError(404, 'not-found', '找不到本地客户端接口。')

  if (method === 'GET' && equal(segments, ['api', 'client', 'connections'])) return remote.listConnections()
  if (method === 'GET' && equal(segments, ['api', 'client', 'operations'])) return remote.listOperations()

  if (method === 'POST' && equal(segments, ['api', 'client', 'connections'])) {
    const body = await readJson(request)
    return remote.beginConnection(requiredString(body, 'origin', 2048), requiredString(body, 'clientName', 120))
  }

  if (segments[2] === 'authorizations' && segments[3] !== undefined) {
    const authorizationId = deviceAuthorization(segments[3])
    if (method === 'POST' && equal(segments.slice(4), ['poll'])) return remote.pollConnection(authorizationId)
    if (method === 'DELETE' && segments.length === 4) return remote.cancelConnection(authorizationId)
  }

  if (segments[2] === 'connections' && segments[3] !== undefined) {
    const selectedConnection = connection(segments[3])
    if (method === 'GET' && equal(segments.slice(4), ['verify'])) {
      return remote.verifyConnection(selectedConnection)
    }
    if (method === 'GET' && equal(segments.slice(4), ['saved-operations'])) {
      return remote.listSavedOperations(selectedConnection)
    }
    if (method === 'DELETE' && segments.length === 4) return remote.disconnect(selectedConnection)
  }

  if (segments[2] === 'operations' && segments[3] !== undefined && method === 'POST' && segments.length === 4) {
    const body = await readJson(request)
    return remote.execute(connection(requiredString(body, 'connectionId', 80)), operation(segments[3]))
  }

  if (segments[2] === 'results' && segments[3] !== undefined && method === 'POST') {
    const body = await readJson(request)
    const selectedConnection = connection(requiredString(body, 'connectionId', 80))
    const resultId = operationResult(segments[3])
    if (equal(segments.slice(4), ['reuse'])) {
      return remote.reuse(selectedConnection, operation(requiredString(body, 'operationId', 80)), resultId)
    }
    if (equal(segments.slice(4), ['save'])) {
      return remote.saveResult(
        selectedConnection,
        operation(requiredString(body, 'operationId', 80)),
        resultId,
        requiredString(body, 'label', 120),
      )
    }
  }

  if (segments[2] === 'saved-operations' && segments[3] !== undefined
    && method === 'POST' && equal(segments.slice(4), ['refresh'])) {
    const body = await readJson(request)
    return remote.refreshSavedOperation(connection(requiredString(body, 'connectionId', 80)), savedOperation(segments[3]))
  }

  throw new RequestError(404, 'not-found', '找不到本地客户端接口。')
}

function assertSameOrigin(request: IncomingMessage, expectedOrigin: string): void {
  const origin = request.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) {
    throw new RequestError(403, 'cross-origin-denied', '本地客户端拒绝跨站请求。')
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_JSON_BYTES) throw new RequestError(413, 'request-too-large', '请求内容超过本地客户端限制。')
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'invalid-request', '请求必须是 JSON 对象。')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'invalid-request', '请求必须是 JSON 对象。')
  }
  return value as Record<string, unknown>
}

function requiredString(value: Record<string, unknown>, key: string, maximumLength: number): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0 || field.length > maximumLength) {
    throw new RequestError(400, 'invalid-request', `请求字段 ${key} 无效。`)
  }
  return field
}

function connection(value: string) {
  if (!/^oryh-[1-9][0-9]*$/u.test(value)) throw invalidIdentifier()
  return connectionId(value)
}

function deviceAuthorization(value: string) {
  if (!/^authorization-[1-9][0-9]*$/u.test(value)) throw invalidIdentifier()
  return deviceAuthorizationId(value)
}

function operationResult(value: string) {
  if (!/^result-[1-9][0-9]*$/u.test(value)) throw invalidIdentifier()
  return operationResultId(value)
}

function savedOperation(value: string) {
  if (!/^saved-operation-[1-9][0-9]*$/u.test(value)) throw invalidIdentifier()
  return savedOperationId(value)
}

function operation(value: string): OperationId {
  if (value === 'my-open-todos' || value === 'my-expense-claims' || value === 'list-projects') return value
  throw invalidIdentifier()
}

function invalidIdentifier(): RequestError {
  return new RequestError(400, 'invalid-request', '本地客户端标识无效。')
}

function equal(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const content = JSON.stringify(value)
  response.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }))
  response.end(content)
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof RequestError) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message } })
    return
  }
  if (isOryhClientError(error)) {
    sendJson(response, clientErrorStatus(error), { error: { code: error.code, message: error.message } })
    return
  }
  sendJson(response, 500, { error: { code: 'local-client-failed', message: 'ORYH 本地客户端发生未预期错误。' } })
}

function securityHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }
}

function isOryhClientError(error: unknown): error is OryhClientError {
  return error instanceof Error && error.name === 'OryhClientError' && 'code' in error
}

function clientErrorStatus(error: OryhClientError): number {
  if (error.status !== undefined) return error.status
  switch (error.code) {
    case 'authentication-failed':
    case 'refresh-failed':
      return 401
    case 'connection-not-found':
    case 'operation-not-found':
      return 404
    case 'connection-identity-mismatch':
    case 'connection-verification-required':
      return 409
    case 'cross-connection-result':
      return 409
    default:
      return 400
  }
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}
