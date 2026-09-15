import { describe, expect, it } from 'vitest'
import { ownerAdmission } from '../src/owner-admission.js'

const admission = ownerAdmission({ workspace: '/data/owner/workspace', preset: 'oryh-server' })
const call = (namespace: string, method: string, args: Record<string, unknown> = {}) => admission.admit({ namespace, method, args })

describe('owner admission', () => {
  it('never serves credentials, model discovery, dynamic code, plugin inventory, preset management or anything unlisted', async () => {
    await expect(call('credentials', 'describe', { refs: ['DEEPSEEK_API_KEY'] })).resolves.toBeDefined()
    for (const [namespace, method] of [['credentials', 'set'], ['credentials', 'unset'], ['toString', 'call'], ['constructor', 'x'], ['someFuturePlugin', 'run'], ['workspace', 'delete'], ['subagents', 'prompt'], ['llm', 'discoverModels'], ['dynamicCordisRunner', 'runHostHalf'], ['pluginInventory', 'list'], ['agentPresets', 'copy'], ['directoryPicker', 'list'], ['session', 'selectModel'], ['session', 'openWorkspacePath'], ['settings', 'openSettingsDocument']]) {
      await expect(call(namespace!, method!)).rejects.toThrow('not available')
    }
  })

  it('lets a person change presentation settings, never a provider or model', async () => {
    await expect(call('settings', 'update', { ns: 'ui-theme', patch: { preference: 'dark' } })).resolves.toBeDefined()
    await expect(call('settings', 'describe')).resolves.toBeDefined()
    for (const ns of ['llm-deepseek', 'agent-default-model', 'subagent-model-selection']) {
      await expect(call('settings', 'mutate', { ns, ops: [] })).rejects.toThrow('not available')
    }
  })

  it('keeps sessions in the assigned workspace on the server preset', async () => {
    await expect(call('workspace', 'create', { request: { path: '/etc' } })).rejects.toThrow('not available')
    await expect(call('workspace', 'create', { request: { path: '/data/owner/workspace' } })).resolves.toBeDefined()
    await expect(call('session', 'create', { request: { cwd: '/tmp' } })).rejects.toThrow('not available')
    await expect(call('session', 'create', { request: { agentPreset: 'standard' } })).rejects.toThrow('not available')
    const created = await call('session', 'create', { request: { workspaceId: 'w1' } })
    expect(created.args.request).toEqual({ workspaceId: 'w1', agentPreset: 'oryh-server' })
    await expect(call('oryh', 'timesheetList', { request: { connectionId: 'c' } })).resolves.toBeDefined()
  })
})
