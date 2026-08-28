/** Error reported by ORYH or a local adapter without exposing credential material. */
export class OryhClientError extends Error {
  constructor(
    message: string,
    readonly code: OryhClientErrorCode,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OryhClientError'
  }
}

/** Stable categories used by the UI and Host integration. */
export type OryhClientErrorCode =
  | 'authentication-failed'
  | 'connection-not-found'
  | 'cross-connection-result'
  | 'invalid-response'
  | 'operation-not-found'
  | 'refresh-failed'
  | 'request-failed'
  | 'unsupported-origin'
