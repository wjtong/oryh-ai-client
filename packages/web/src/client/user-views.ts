import {useMemo, useSyncExternalStore} from 'react'
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store'
import type {ConnectionSummary} from '@oryh/ai-client-core'
import type {UserViewSummary} from '@oryh/dsh-host/types'
import {isRecordKind} from './records.js'
import {columnPreferenceScope} from './column-preferences.js'

/** How many menu entries one person may keep, so a runaway agent cannot bury the menu. */
export const USER_VIEW_LIMIT = 30
/** A user view's page id: the frame store and the menu use it; the Host never sees it. */
export type UserViewPage = `view:${string}`
export const userViewPage = (id: string): UserViewPage => `view:${id}`
export const isUserViewPage = (page: string): page is UserViewPage => /^view:[0-9a-f-]{36}$/.test(page)

/**
 * Menu entries a person made through Chat, kept per enterprise identity in this browser.
 *
 * Tenant-wide definitions and roaming across devices both need a server resource ORYH does not have
 * yet; until then this is the honest scope. Only the definition is stored — label, list and filters
 * — never rows, and never anything a filter could not be rebuilt from.
 */
export interface UserViewStore {
  getSnapshot(): readonly UserViewSummary[]
  subscribe(listener: () => void): () => void
  add(view: UserViewSummary): void
  remove(id: string): void
}

/**
 * Drop anything that is not a well-formed entry. Harness hydrates raw JSON from storage, so what
 * comes back is untrusted input until it has been through this.
 */
export function normalizeUserViews(value: unknown): UserViewSummary[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>(), labels = new Set<string>()
  const views: UserViewSummary[] = []
  for (const entry of value) {
    const v = entry as Partial<UserViewSummary> | null
    if (!v || typeof v.id !== 'string' || !/^[0-9a-f-]{36}$/.test(v.id) || seen.has(v.id)) continue
    if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 24 || labels.has(v.label)) continue
    if (typeof v.kind !== 'string' || !isRecordKind(v.kind)) continue
    const filters = v.filters && typeof v.filters === 'object' && !Array.isArray(v.filters) ? v.filters : undefined
    if (!filters || Object.entries(filters).some(([k, val]) => !/^[a-z_][a-z0-9_]{0,63}$/.test(k) || typeof val !== 'string' || !val || val.length > 200)) continue
    seen.add(v.id); labels.add(v.label)
    views.push({id: v.id, label: v.label, kind: v.kind, filters: {...filters}})
    if (views.length >= USER_VIEW_LIMIT) break
  }
  return views
}

/** One live store per identity, shared by the menu and the workbench so an edit shows everywhere at once. */
const stores = new Map<string, UserViewStore>()

export function userViewStore(scope: string): UserViewStore {
  const existing = stores.get(scope)
  if (existing) return existing
  const snapshot = createSnapshotStore<UserViewSummary[]>([], {persist: {name: `oryh.views.v1:${scope}`}})
  snapshot.set(normalizeUserViews(snapshot.getSnapshot()))
  const store: UserViewStore = {
    getSnapshot: snapshot.getSnapshot,
    subscribe: snapshot.subscribe,
    add: view => snapshot.set(normalizeUserViews([...snapshot.getSnapshot().filter(v => v.id !== view.id), view])),
    remove: id => snapshot.set(snapshot.getSnapshot().filter(v => v.id !== id)),
  }
  stores.set(scope, store)
  return store
}

/** The person's menu entries for this enterprise identity, live. */
export function useUserViews(connection: ConnectionSummary | undefined) {
  const scope = connection ? columnPreferenceScope(connection) : ''
  const store = useMemo(() => scope ? userViewStore(scope) : undefined, [scope])
  const empty = useMemo(() => [] as readonly UserViewSummary[], [])
  const views = useSyncExternalStore(store?.subscribe ?? (() => () => {}), store?.getSnapshot ?? (() => empty), store?.getSnapshot ?? (() => empty))
  return {views, store}
}
