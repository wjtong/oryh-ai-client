import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as plugin from '../src/index.js'
import { TYPERT } from '../lib/typert.host.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

describe('ORYH external Host plugin', () => {
  it('runs generated Remote through real Cordis and Gateway, then disposes the services', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'oryh-dsh-plugin-'))
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry)
      await ctx.plugin(Gateway)
      ctx.provide('tools', {})
      ctx.get('typert').register(TYPERT)
      const fiber = ctx.plugin(plugin, { developmentOnly: true, dataDirectory })
      await fiber
      const removeRestriction = vi.fn()
      const restrict = vi.fn(() => removeRestriction)
      ctx.emit('agent/created', { agent: { ctx: { tools: { restrict } } } } as never)
      expect(restrict).toHaveBeenCalledWith({ allow: [] })
      expect(await ctx.waterfall('tools/pre-execute', {} as never, async () => ({ kind: 'allow' }))).toMatchObject({ kind: 'deny' })
      const invoke = (method: string, args: Record<string, unknown> = {}) => ctx.get('typertGateway').invoke({ namespace: 'oryh', method, args })
      expect(await invoke('listConnections')).toEqual([])
      expect(await invoke('listOperations')).toHaveLength(3)
      await expect(invoke('expenseList', { request: { connectionId: 'unknown' } })).rejects.toMatchObject({ code: 'oryh/business', details: { code: 'connection-not-found' } })
      await expect(invoke('expenseList', { request: { connectionId: 17 } })).rejects.toMatchObject({ code: 'gateway/input-invalid' })
      await expect(invoke('listConnections', { extra: 'not accepted' })).rejects.toThrow()
      let inFlight: AbortSignal | undefined
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => new Promise((_resolve, reject) => {
        inFlight = init?.signal ?? undefined
        inFlight?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      }))
      const cancelled = expect(invoke('beginConnection', { request: { origin: 'http://localhost:8080', clientName: 'test' } })).rejects.toMatchObject({ code: 'oryh/business' })
      await vi.waitFor(() => expect(inFlight).toBeDefined())
      await fiber.dispose()
      await cancelled
      expect(inFlight?.aborted).toBe(true)
      expect(removeRestriction).toHaveBeenCalled()
      expect(await ctx.waterfall('tools/pre-execute', {} as never, async () => ({ kind: 'allow' }))).toEqual({ kind: 'allow' })
      expect(ctx.get('oryhClient')).toBeUndefined()
      expect(ctx.get('oryhExpenses')).toBeUndefined()
      await expect(invoke('listConnections')).rejects.toThrow()
    } finally { vi.restoreAllMocks(); await ctx.fiber.dispose(); await rm(dataDirectory, { recursive: true, force: true }) }
  })

  it('serializes compile-time branded IDs as strings, and preserves strict confirmation types', () => {
    const method = (name: string) => TYPERT_REMOTE.descriptors.find(item => item.method === name)!
    expect(method('verifyConnection').parameters[0]!.codec!.schema.safeParse({ connectionId: 'connection-1' }).success).toBe(true)
    expect(method('verifyConnection').parameters[0]!.codec!.schema.safeParse({ connectionId: 42 }).success).toBe(false)
    expect(method('expenseConfirm').parameters[0]!.codec!.schema.safeParse({ connectionId: 'c', id: 'd', revision: 1 }).success).toBe(false)
  })

  it('rejects relative persistence paths and unvalidated production composition', () => {
    const ctx = new Context()
    expect(() => plugin.apply(ctx, { developmentOnly: true, dataDirectory: './data' })).toThrow(/absolute path/)
    expect(() => plugin.apply(ctx, { developmentOnly: false })).toThrow(/developmentOnly/)
  })
})
