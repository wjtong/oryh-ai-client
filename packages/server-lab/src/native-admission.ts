/** Owner-local native Remote policy. The outer authenticated proxy owns browser/grant admission. */
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway'
import { requireOwnerWorkspace, type OwnerWorkspace } from './owner-workspace.js'
import type { GatewayAdmission } from './server-gateway.js'
const deny = () => new Error('This session or workspace is unavailable')
const sessionMethods = new Set(['list','search','create','selectModel','modelCatalog','rename','fork','prompt','updateQueue','cancel','page','follow','control','canOpenWorkspacePath','attachment'])
const workspaceMethods = new Set(['follow','rename','archiveSession','insertSessionBefore'])
function object(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw deny()
  return value as Record<string, unknown>
}
export function nativeAdmission(options: {
  owner: string; workspace: OwnerWorkspace; workspaceId: string; preset: string; signal: AbortSignal
  sessionMetadata(id: string): Promise<{ readonly cwd?: string; readonly agentPreset?: string } | undefined>
}): GatewayAdmission {
  return { async admit(input) {
    options.signal.throwIfAborted()
    const path = await requireOwnerWorkspace(options.workspace, options.owner)
    async function ownedSession(id: unknown) {
      if (typeof id !== 'string') throw deny()
      const meta = await options.sessionMetadata(id)
      if (meta?.cwd !== path || meta.agentPreset !== options.preset) throw deny()
    }
    const args: Record<string, unknown> = { ...structuredClone(input.args) }
    const request = object(args.request)
    const signal = AbortSignal.any([options.signal, ...(input.signal ? [input.signal] : [])])
    signal.throwIfAborted()
    if (input.namespace === 'session' ? !sessionMethods.has(input.method)
      : input.namespace === 'workspace' ? !workspaceMethods.has(input.method) : true) throw deny()
    if (request.cwd !== undefined && request.cwd !== path) throw deny()
    if (request.workspaceId !== undefined && request.workspaceId !== options.workspaceId) throw deny()
    if (request.agentPreset !== undefined && request.agentPreset !== options.preset) throw deny()
    // History uses a nested discriminated address, unlike commands.
    if (input.namespace === 'session' && ['page', 'follow'].includes(input.method)) {
      const address = object(request.address)
      if (address.kind !== 'session' && address.kind !== 'subagent') throw deny()
      const ids = address.kind === 'session' ? [address.sessionId] : [address.parentSessionId, address.childSessionId]
      for (const id of ids) await ownedSession(id)
    }
    // Every supplied Session reference is checked, including ordering and fork sources.
    for (const [key,value] of Object.entries(request)) if (/sessionId$/i.test(key) && value !== undefined && value !== null) {
      await ownedSession(value)
    }
    if (input.namespace === 'session' && input.method === 'create') {
      // Browser-selected Session IDs cannot adopt another existing or invented identity.
      if (request.sessionId !== undefined) throw deny()
      delete request.cwd
      request.workspaceId = options.workspaceId
      request.agentPreset = options.preset
      args.request = request
    }
    signal.throwIfAborted()
    return { ...input, args, signal }
  } }
}
