import type {
  BeginConnectionView,
  ConnectionId,
  ConnectionSummary,
  DeviceAuthorizationId,
  OperationDefinition,
  OperationId,
  OperationResultId,
  OryhClientRemote,
  OryhOperationResult,
  PollConnectionView,
  SavedOperationId,
  SavedOperationView,
} from '@oryh/ai-client-core'

/** Browser transport for the local Host's narrow, same-origin Remote routes. */
export class LocalOryhRemote implements OryhClientRemote {
  async beginConnection(origin: string, clientName: string): Promise<BeginConnectionView> {
    return this.request('/api/client/connections', { method: 'POST', body: { origin, clientName } })
  }

  async pollConnection(authorizationId: DeviceAuthorizationId): Promise<PollConnectionView> {
    return this.request(`/api/client/authorizations/${authorizationId}/poll`, { method: 'POST' })
  }

  async cancelConnection(authorizationId: DeviceAuthorizationId): Promise<void> {
    await this.request(`/api/client/authorizations/${authorizationId}`, { method: 'DELETE' })
  }

  async listConnections(): Promise<readonly ConnectionSummary[]> {
    return this.request('/api/client/connections')
  }

  async verifyConnection(connectionId: ConnectionId): Promise<ConnectionSummary> {
    return this.request(`/api/client/connections/${connectionId}/verify`)
  }

  async listOperations(): Promise<readonly OperationDefinition[]> {
    return this.request('/api/client/operations')
  }

  async execute(connectionId: ConnectionId, operationId: OperationId): Promise<OryhOperationResult> {
    return this.request(`/api/client/operations/${operationId}`, { method: 'POST', body: { connectionId } })
  }

  async reuse(
    connectionId: ConnectionId,
    operationId: OperationId,
    resultId: OperationResultId,
  ): Promise<OryhOperationResult> {
    return this.request(`/api/client/results/${resultId}/reuse`, { method: 'POST', body: { connectionId, operationId } })
  }

  async saveResult(
    connectionId: ConnectionId,
    operationId: OperationId,
    resultId: OperationResultId,
    label: string,
  ): Promise<SavedOperationView> {
    return this.request(`/api/client/results/${resultId}/save`, { method: 'POST', body: { connectionId, operationId, label } })
  }

  async listSavedOperations(connectionId: ConnectionId): Promise<readonly SavedOperationView[]> {
    return this.request(`/api/client/connections/${connectionId}/saved-operations`)
  }

  async refreshSavedOperation(connectionId: ConnectionId, savedOperationId: SavedOperationId): Promise<OryhOperationResult> {
    return this.request(`/api/client/saved-operations/${savedOperationId}/refresh`, { method: 'POST', body: { connectionId } })
  }

  async disconnect(connectionId: ConnectionId): Promise<void> {
    await this.request(`/api/client/connections/${connectionId}`, { method: 'DELETE' })
  }

  private async request<Result>(path: string, options: RequestOptions = {}): Promise<Result> {
    const init: RequestInit = {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
    }
    if (options.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(options.body)
    }
    const response = await fetch(path, init)
    const body: unknown = await response.json()
    if (!response.ok) throw responseError(body)
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !('data' in body)) {
      throw new LocalRemoteError('invalid-response', 'ORYH 本地客户端返回了无效响应。')
    }
    return (body as { data: Result }).data
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE'
  readonly body?: Record<string, unknown>
}

/** Error presentation safe for rendering in the local workbench. */
export class LocalRemoteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'LocalRemoteError'
  }
}

function responseError(value: unknown): LocalRemoteError {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'error' in value) {
    const error = value.error
    if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
      const fields = error as Record<string, unknown>
      if (typeof fields.code === 'string' && typeof fields.message === 'string') {
        return new LocalRemoteError(fields.code, fields.message)
      }
    }
  }
  return new LocalRemoteError('request-failed', 'ORYH 本地客户端未能完成请求。')
}
