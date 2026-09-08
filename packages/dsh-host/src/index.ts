/** ORYH business services contributed through the DSH Cordis Host plugin lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import { OryhRemote } from './remote.js'
export * from './remote.js'
import { createLocalOryhRuntime } from '@oryh/ai-client-core'

/** Single-user development composition; tenant-bound AI tools are not enabled. */
export interface Config {
  readonly developmentOnly: boolean
  /** Absolute application data path; omitted uses the standard ORYH application directory. */
  readonly dataDirectory?: string
}

export const Config: z<Config> = z.object({
  developmentOnly: z.boolean().required(),
  dataDirectory: z.string(),
})

export const name = 'oryh-client-host'
export const inject = ['typert', 'tools']

/**
 * Register Host-only business services backed by OS credentials and persistent stores.
 * No HTTP listener, browser transport, model loop, or unrestricted tool is installed.
 * The Remote is browser-only. Model tools remain disabled until tenant-bound Sessions are implemented.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.developmentOnly !== true) {
    throw new Error('oryh-client-host: requires developmentOnly: true; tenant-bound AI tools are not enabled')
  }
  const runtime = createLocalOryhRuntime(config.dataDirectory)
  ctx.provide('oryhClient', runtime.controller)
  ctx.provide('oryhExpenses', runtime.expenses)
  ctx.provide('oryhAbort', runtime.abort)
  ctx.plugin(OryhRemote)
  // Until tenant-bound business tools exist, every Agent is conversation-only.
  ctx.on('agent/created', ({ agent }) => { ctx.effect(() => agent.ctx.tools.restrict({ allow: [] }), 'oryh conversation-only policy') })
  ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'ORYH Profile has no model-callable business capabilities configured.' }))
}
