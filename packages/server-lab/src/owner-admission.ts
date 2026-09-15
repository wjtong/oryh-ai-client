/**
 * Gateway admission for one person's Host on the ORYH server (docs/33 §3).
 *
 * The Host serves exactly one owner, so every session, workspace and draft in it is that person's;
 * cross-owner checks happen before a request reaches this process. What remains is keeping the
 * browser from using Harness capabilities a server Host must not offer, even though the web UI that
 * would call them is disabled: nothing stops a signed-in person from calling a Remote by hand.
 *
 * - Credentials and model endpoints are the deployment's; reading, changing or probing them would
 *   let someone send the deployment's model key elsewhere.
 * - Dynamic code, plugin inventory and preset management are not offered at all.
 * - The only workspace is the one the server assigned, and every session runs the server preset.
 */
import type { Context } from '@deepseek-ai/cordis'
import type Gateway from '@deepseek-ai/dsh-api-gateway'
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import type { GatewayAdmission } from './server-gateway.js'

const unavailable = () => new Error('This operation is not available on the ORYH server.')

/**
 * What a server Host serves to a browser: a namespace with every method (`true`), or only the listed
 * methods. Everything else is refused. The list is what the ORYH workbench, the Chat pane and its file,
 * attachment and feedback surfaces call (recorded with ORYH_ADMISSION_TRACE, docs/33 §6).
 */
const SERVED: Readonly<Record<string, true | ReadonlySet<string>>> = {
  oryh: true,
  session: new Set(['list', 'search', 'create', 'modelCatalog', 'rename', 'fork', 'prompt', 'attachment', 'updateQueue', 'cancel', 'page', 'follow', 'control']),
  workspace: new Set(['follow', 'create', 'rename', 'insertBefore', 'insertSessionBefore', 'archiveSession']),
  workspaceFiles: true,
  // Reads whether a credential is configured, never its value; setting one is not served.
  credentials: new Set(['describe']),
  settings: new Set(['describe', 'update', 'replace', 'mutate']),
  commands: true,
  skills: true,
  subagents: new Set(['list', 'interruptByParent']),
  goals: new Set(['get']),
  fileReferences: true,
  fileUploads: true,
  attachments: true,
  messageFeedback: true,
  sessionFeedback: true,
  sessionReferenceResolver: true,
}
/** Settings a person may change for themselves: presentation only, never a provider or a model. */
const PERSONAL_SETTINGS = new Set(['ui-theme', 'locale', 'ui-onboarding'])

export interface OwnerAdmissionOptions {
  /** The owner's assigned workspace directory, as the control process created it. */
  readonly workspace: string
  /** The one agent preset sessions on this Host run. */
  readonly preset: string
  /** Report each decision, without arguments, for auditing what the web UI actually calls. */
  readonly trace?: (line: string) => void
}

/**
 * The admission policy, separate from its plugin so it can be tested without a Host.
 * @param options - the owner's fixed workspace and preset.
 * @returns the admission the server Gateway applies to every invocation and stream.
 */
export function ownerAdmission(options: OwnerAdmissionOptions): GatewayAdmission {
  return {
    async admit(input: InvokeRemoteRequest): Promise<InvokeRemoteRequest> {
      const key = `${input.namespace}.${input.method}`
      try {
        const admitted = decide(input, options)
        options.trace?.(`allow ${key}`)
        return admitted
      } catch (error) {
        options.trace?.(`deny ${key}`)
        throw error
      }
    },
  }
}

function decide(input: InvokeRemoteRequest, options: OwnerAdmissionOptions): InvokeRemoteRequest {
  const served = Object.hasOwn(SERVED, input.namespace) ? SERVED[input.namespace] : undefined
  if (served === undefined || (served !== true && !served.has(input.method))) throw unavailable()
  if (input.namespace === 'settings' && ['update', 'replace', 'mutate'].includes(input.method)) {
    if (typeof input.args.ns !== 'string' || !PERSONAL_SETTINGS.has(input.args.ns)) throw unavailable()
    return input
  }
  if (input.namespace === 'workspace' && input.method === 'create') {
    const request = record(input.args.request)
    if (request.path !== options.workspace) throw unavailable()
    return input
  }
  if (input.namespace === 'session' && input.method === 'create') {
    const request = record(input.args.request)
    if (request.cwd !== undefined && request.cwd !== options.workspace) throw unavailable()
    if (request.agentPreset !== undefined && request.agentPreset !== options.preset) throw unavailable()
    return { ...input, args: { ...input.args, request: { ...request, agentPreset: options.preset } } }
  }
  return input
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw unavailable()
  return value as Record<string, unknown>
}

export const name = 'oryh-owner-admission'
export const inject = ['workspaceRegistry', 'typertGateway']

export interface Config {
  readonly preset: string
  readonly trace?: boolean
}
export const Config: z<Config> = z.object({
  preset: z.string().required(),
  trace: z.boolean(),
})

/**
 * Register the owner's workspace and put the admission in front of the Profile's own Gateway.
 *
 * The Gateway row stays the shipped one: its browser half is listed in the client module table by
 * that row's package, so replacing the row with a subclass from another package drops the browser
 * half and the workbench cannot load. Its public `invoke` and `stream` — through which HTTP dispatch
 * and mux streams run — are wrapped on the live instance instead, and restored on dispose.
 * The workspace path comes from the control process that started this Host, never from the browser.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const workspace = process.env.ORYH_OWNER_WORKSPACE
  if (!workspace) throw new Error('oryh-owner-admission: ORYH_OWNER_WORKSPACE is required')
  await ctx.workspaceRegistry.create(workspace, '我的工作区')
  const admission = ownerAdmission({
    workspace,
    preset: config.preset,
    ...config.trace ? { trace: line => process.stderr.write(`oryh-admission: ${line}\n`) } : {},
  })
  const gateway = ctx.typertGateway as Gateway & Record<'invoke' | 'stream', unknown>
  const invoke = gateway.invoke.bind(gateway), stream = gateway.stream.bind(gateway)
  gateway.invoke = async (request: InvokeRemoteRequest) => invoke(await admission.admit(request))
  gateway.stream = async (request: InvokeRemoteRequest) => stream(await admission.admit(request))
  ctx.effect(() => () => { delete (gateway as Partial<Record<'invoke' | 'stream', unknown>>).invoke; delete (gateway as Partial<Record<'invoke' | 'stream', unknown>>).stream }, 'oryh owner admission')
}
