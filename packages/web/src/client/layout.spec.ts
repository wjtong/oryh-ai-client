// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerFrame } from './layout.js'
import { createFrameStore } from './layout-store.js'
import { presentTheme } from './theme.js'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

describe('external ORYH root composition', () => {
  beforeEach(()=>localStorage.clear())
  it('owns compatible slots, wires layout actions, and releases them on unload', async () => {
    const ctx = new Context()
    const slots = new SlotCore()
    // Real public slot core; renderer service is the transport of the same register contract.
    ctx.provide('slots', slots as never)
    const fiber = ctx.plugin({ apply: registerFrame })
    await fiber.await()
    expect(slots.entriesOfSlot('root')).toHaveLength(1)
    expect(slots.spec('oryh.business')).toEqual({ kind: 'single', scope: 'root' })
    expect(slots.spec('conversation')).toEqual({ kind: 'single', scope: 'session-maybe' })
    expect(slots.spec('rightbar')).toEqual({ kind: 'single', scope: 'session' })
    const instance = createFrameStore().create()
    const entry = slots.entriesOfSlot('root')[0]!
    entry.inject!(instance.actions)
    ctx.layout.toggleSidebar()
    expect(instance.store.getSnapshot().collapsed).toBe(false)
    ctx.layout.openRightbar(true, true)
    expect(instance.store.getSnapshot().rightbarFullscreen).toBe(true)
    ctx.layout.closeRightbar()
    expect(instance.store.getSnapshot().rightbarShown).toBe(false)
    const stale = slots.register({ name: 'oryh.business' }, () => null)
    await fiber.dispose()
    expect(ctx.get('layout')).toBeUndefined()
    expect(slots.entriesOfSlot('root')).toHaveLength(0)
    expect(slots.spec('oryh.business')).toBeUndefined()
    expect(slots.spec('conversation')).toBeUndefined()
    expect(() => stale()).not.toThrow()
    const replacement = ctx.plugin({ apply: registerFrame })
    await replacement.await()
    expect(slots.entriesOfSlot('root')).toHaveLength(1)
    await replacement.dispose()
    instance.dispose?.()
  })
  it('keeps business selection through chat, viewport and native panel transitions', () => {
    const instance = createFrameStore().create()
    const { actions, store } = instance
    actions.navigate('my-expense-claims')
    expect(store.getSnapshot().chatWidth).toBe(360)
    actions.setChatWidth(473);expect(store.getSnapshot().chatWidth).toBe(473)
    actions.setChatWidth(10);expect(store.getSnapshot().chatWidth).toBe(280)
    actions.setChatWidth(NaN);expect(store.getSnapshot().chatWidth).toBe(280)
    actions.setChatWidth(473)
    actions.showChat(); actions.measure(390); actions.toggleChat()
    expect(store.getSnapshot().focus).toBe('business')
    actions.openRightbar(false, true); actions.closeRightbar(); actions.showBusiness()
    expect(store.getSnapshot().page).toBe('my-expense-claims')
    expect(store.getSnapshot().chatWidth).toBe(473)
    const anotherRoot = createFrameStore().create()
    expect(anotherRoot.store.getSnapshot().page).toBe('my-expense-claims')
    expect(anotherRoot.getSnapshot().chatWidth).toBe(473)
    expect(anotherRoot.getSnapshot().chatVisible).toBe(false)
    expect(anotherRoot.getSnapshot().viewport).toBe(1280)
    instance.dispose?.(); anotherRoot.dispose?.()
  })
  it('projects public theme snapshots and restores prior DOM on plugin unload', async () => {
    const ctx = new Context()
    document.body.style.setProperty('--oryh-test-token', 'old')
    const snapshot = { active: { id: 'light', colorScheme: 'light', tokens: { '--oryh-test-token': 'new' } }, fontSize: 16 } as ThemeSnapshot
    ctx.provide('theme', { getTheme: () => snapshot } as never)
    const fiber = ctx.plugin({ apply: presentTheme }); await fiber.await()
    expect(document.body.style.getPropertyValue('--oryh-test-token')).toBe('new')
    ctx.emit('theme/change', { ...snapshot, active: { id: 'dark', colorScheme: 'dark', tokens: {} } })
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.body.style.getPropertyValue('--oryh-test-token')).toBe('old')
    await fiber.dispose()
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.body.style.getPropertyValue('--oryh-test-token')).toBe('old')
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull()
    document.body.style.removeProperty('--oryh-test-token')
  })
})
