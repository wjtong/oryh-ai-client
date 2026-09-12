/** One Host command stream per bound session, shared by every business view. */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { CommandSnapshot } from '@oryh/dsh-host/types'
import type { ConnectionId } from '@oryh/ai-client-core/types'
import { useOryhRemote } from './remote.js'

/** Published command state: the last full set the Host sent, plus any terminal failure. */
export interface CommandState {
  /** Every command pending for the bound session. */
  readonly commands: CommandSnapshot
  /** Set once the stream fails terminally; the last commands stay published. */
  readonly error?: string
}

/** React-free subscription surface, so views never own a transport. */
export interface CommandStore {
  getSnapshot(): CommandState
  subscribe(listener: () => void): () => void
}

/** A store plus the lifecycle its owner drives. */
export interface CommandStreamHandle extends CommandStore {
  /** Begin consuming; repeated calls are inert. */
  start(): void
  /** Stop permanently and wait for the consumer to become quiescent. */
  dispose(): Promise<void>
}

const idle: CommandState = { commands: {} }
const unbound: CommandStore = { getSnapshot: () => idle, subscribe: () => () => {} }

/** Unbound default: views outside a bound session simply see no commands. */
export const CommandsContext = createContext<CommandStore>(unbound)

/**
 * Read the session's pending commands.
 * @returns the latest published set, re-rendering the caller on every change.
 */
export function useCommands(): CommandState {
  const store = useContext(CommandsContext)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/**
 * Bind the session to its enterprise home, then follow its commands for every view below.
 *
 * The bind has to land before the stream opens: the Host refuses an unbound session, and a
 * refusal is terminal rather than retried. Leaving the session withdraws the binding.
 * @param props - the bound session, its connection, and the views that read commands.
 */
export function CommandStream({ sessionId, connectionId, children }: {
  sessionId: string | undefined
  connectionId: ConnectionId
  children: ReactNode
}): ReactNode {
  const api = useOryhRemote()
  const [store, setStore] = useState<CommandStreamHandle>()
  useEffect(() => {
    if (sessionId === undefined) return
    let live = true, timer: ReturnType<typeof setTimeout> | undefined, handle: CommandStreamHandle | undefined
    function bind(): void {
      void api.chatSelect({ sessionId: sessionId!, connectionId, homeOnly: true }).then(() => {
        if (!live) return
        handle = api.openCommands({ sessionId: sessionId!, connectionId })
        handle.start()
        setStore(handle)
      }).catch(() => { if (live) timer = setTimeout(bind, 500) })
    }
    bind()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      setStore(undefined)
      void handle?.dispose()
      void api.chatHomeClear(sessionId).catch(() => {})
    }
  }, [api, sessionId, connectionId])
  return <CommandsContext.Provider value={store ?? unbound}>{children}</CommandsContext.Provider>
}
