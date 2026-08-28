import type { ConnectionId } from './brand.js'

/** Secret pair returned by the ORYH device flow and refresh endpoint. */
export interface CredentialPair {
  readonly accessKey: string
  readonly refreshToken: string
  readonly expiresAt: string | null
}

/** Host-only storage for short-lived ORYH access and refresh credentials. */
export interface CredentialVault {
  read(connectionId: ConnectionId): Promise<CredentialPair | undefined>
  write(connectionId: ConnectionId, credential: CredentialPair): Promise<void>
  remove(connectionId: ConnectionId): Promise<void>
}

/** Test and development-only vault; production adapters must use the OS keychain. */
export class MemoryCredentialVault implements CredentialVault {
  readonly #credentials = new Map<ConnectionId, CredentialPair>()

  async read(connectionId: ConnectionId): Promise<CredentialPair | undefined> {
    return this.#credentials.get(connectionId)
  }

  async write(connectionId: ConnectionId, credential: CredentialPair): Promise<void> {
    this.#credentials.set(connectionId, credential)
  }

  async remove(connectionId: ConnectionId): Promise<void> {
    this.#credentials.delete(connectionId)
  }
}
