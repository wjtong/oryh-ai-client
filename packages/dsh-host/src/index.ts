import { join } from 'node:path'
import { BusinessChat } from './business-chat.js'
import { defaultOryhDataDirectory } from '@oryh/ai-client-core'
/** ORYH business services contributed through the DSH Cordis Host plugin lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import { OryhRemote } from './remote.js'
export * from './remote.js'
import { createLocalOryhRuntime } from '@oryh/ai-client-core'

/** Single-user development composition with session-bound read-only business tools. */
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
export const inject = ['typert', 'tools', 'agents', 'systemPrompt']

/**
 * Register Host-only business services backed by OS credentials and persistent stores.
 * No HTTP listener, browser transport, model loop, or unrestricted tool is installed.
 * Browser confirmations stay outside model tools; a separate session-bound tool reads the current todo.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.developmentOnly !== true) {
    throw new Error('oryh-client-host: requires developmentOnly: true; production multi-user composition is not enabled')
  }
  const runtime = createLocalOryhRuntime(config.dataDirectory)
  ctx.provide('oryhClient', runtime.controller)
  ctx.provide('oryhExpenses', runtime.expenses)
  ctx.provide('oryhTimesheets', runtime.timesheets)
  ctx.provide('oryhRecords',runtime.records)
  ctx.provide('oryhProjects',runtime.projects)
  ctx.provide('oryhAbort', runtime.abort)
  ctx.plugin(OryhRemote)
  const chat = new BusinessChat(ctx, runtime.controller, runtime.todoDetails, join(config.dataDirectory ?? defaultOryhDataDirectory(), 'chat-bindings'), runtime.timesheets,runtime.projects, runtime.skills)
  // The page's disabled button is a hint; this is the gate. Wired here because the verdict lives in
  // the chat layer and the confirm lives in the timesheet service, and neither may import the other.
  runtime.timesheets.setSubmitGate((action, sessionId) => { if (action.kind === 'submit') chat.reviews.assertPassed('timesheet', action.headerId, sessionId) })
  runtime.expenses.setSubmitGate((draftId, sessionId) => chat.reviews.assertPassed('expense', draftId, sessionId))
  ctx.provide('oryhSkills', runtime.skills)
  ctx.provide('oryhTodoDetails', runtime.todoDetails)
  ctx.provide('oryhChat', chat)
  chat.install()
}
