import type {ProjectRecord} from '@oryh/ai-client-projects'
import { EncryptedRevisionStore } from '@oryh/ai-client-store'
import { EncryptedTimesheetStore } from '@oryh/ai-client-timesheets'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { EncryptedExpenseStore } from '@oryh/ai-client-expenses'
import { JsonConnectionStore } from './connection-store.js'
import { JsonSavedOperationStore } from './saved-operations.js'
import { KeychainCredentialVault } from './credentials.js'
import { OryhClientController } from './controller.js'
import { OryhClientHost } from './host.js'
import { OryhClientRemoteAdapter } from './remote.js'

/** Host-owned credential and business runtime for the DSH plugin. */
export function createLocalOryhRuntime(dataDirectory = defaultOryhDataDirectory()) {
  if (!isAbsolute(dataDirectory)) throw new Error('ORYH dataDirectory must be an absolute path.')
  if (typeof globalThis.fetch !== 'function') throw new Error('ORYH requires a Host runtime with fetch.')
  const lifetime = new AbortController()
  const host = new OryhClientHost({
    credentialVault: new KeychainCredentialVault(),
    connectionStore: new JsonConnectionStore({ path: join(dataDirectory, 'connections.json') }),
    fetcher: (input, init) => {
      lifetime.signal.throwIfAborted()
      const signal = init?.signal ? AbortSignal.any([init.signal, lifetime.signal]) : lifetime.signal
      return globalThis.fetch(input, { ...init, signal })
    },
  })
  const controller = new OryhClientController(host, {
    savedOperationStore: new JsonSavedOperationStore({ path: join(dataDirectory, 'saved-operations.json') }),
  })
  return {
    controller,
    records:host.createRecordRemote(),
    abort: () => lifetime.abort(),
    remote: new OryhClientRemoteAdapter(controller),
    todoDetails: host.createTodoDetailRemote(),
    projects:host.createProjectRemote(new EncryptedRevisionStore<ProjectRecord>(join(dataDirectory,'projects'),undefined,'ORYH AI Client Project Encryption')),
    timesheets: host.createTimesheetRemote(new EncryptedTimesheetStore(join(dataDirectory, 'timesheets'))),
    expenses: host.createExpenseRemote(new EncryptedExpenseStore(join(dataDirectory, 'expenses'))),
    // ORYH's own convention, and the root Harness scans by default: skills are named per
    // employer, so one agent can serve two companies out of the same directory.
    skills: host.createSkillBundle(join(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'), 'skills')),
  }
}

/** OS-specific application data path; credentials remain in the OS vault. */
export function defaultOryhDataDirectory(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'ORYH AI Client')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? homedir(), 'ORYH AI Client')
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'oryh-ai-client')
}
