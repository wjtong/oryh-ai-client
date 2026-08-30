import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  JsonConnectionStore,
  JsonSavedOperationStore,
  KeychainCredentialVault,
  OryhClientController,
  OryhClientHost,
  OryhClientRemoteAdapter,
  type OryhClientRemote,
} from '@oryh/ai-client-core'

/** Construct the local Host adapter used by the loopback workbench. */
export function createLocalOryhRemote(dataDirectory = defaultDataDirectory()): OryhClientRemote {
  const host = new OryhClientHost({
    credentialVault: new KeychainCredentialVault(),
    connectionStore: new JsonConnectionStore({ path: join(dataDirectory, 'connections.json') }),
    fetcher: globalThis.fetch,
  })
  return new OryhClientRemoteAdapter(new OryhClientController(host, {
    savedOperationStore: new JsonSavedOperationStore({ path: join(dataDirectory, 'saved-operations.json') }),
  }))
}

function defaultDataDirectory(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'ORYH AI Client')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? homedir(), 'ORYH AI Client')
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'oryh-ai-client')
}
