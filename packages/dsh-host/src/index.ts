/**
 * Development-only DeepSeek Harness Host entry for the ORYH AI Client BFF.
 * No DeepSeek Harness package is imported here: Cordis discovers the standard
 * `apply(ctx, config)` entry and supplies its service registry at runtime.
 */

import {
  MemoryCredentialVault,
  OryhClientController,
  OryhClientHost,
  type Fetcher,
} from '@oryh/ai-client-core'

/** Minimal Cordis service-registration surface used by this isolated bundle. */
export interface CordisHostContext {
  provide(name: string, value: unknown): () => void
}

/** Deployment guard preventing a temporary in-memory credential store from becoming a production default. */
export interface Config {
  /** Must remain true until an OS-keychain CredentialVault adapter is supplied. */
  readonly developmentOnly: boolean
}

/** Cordis loader identifier. */
export const name = 'oryh-client-host'

/**
 * Construct and provide the single ORYH BFF controller for a DSH Host process.
 * @param ctx - Cordis Host context receiving the controller service.
 * @param config - explicit development-only guard.
 */
export function apply(ctx: CordisHostContext, config: Config): void {
  if (config.developmentOnly !== true) {
    throw new Error(
      'oryh-client-host: production startup requires an OS-keychain CredentialVault adapter; refusing the in-memory development store',
    )
  }
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('oryh-client-host: this DSH Host runtime does not provide fetch')
  }
  const host = new OryhClientHost({
    credentialVault: new MemoryCredentialVault(),
    fetcher: globalThis.fetch as Fetcher,
  })
  ctx.provide('oryhClient', new OryhClientController(host))
}
