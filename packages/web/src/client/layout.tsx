/** An external root provider: only public slot, store, locale and layout contracts. */
import type { Context } from '@deepseek-ai/cordis'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { BoundActions, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { useLayoutEffect, useRef } from 'react'
import { IconChecklist, IconReceipt, IconFolder, IconSettings, IconLayoutSidebarLeftCollapse, IconMessage } from '@tabler/icons-react'
import { createFrameStore, type BusinessView } from './layout-store.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'oryh.business': { kind: 'single'; scope: 'root'; owner: { page: BusinessView } }
  }
}
type FrameActions = BoundActions<ReturnType<typeof createFrameStore>>
type FrameProps = PropsRuntime<'root'> & PropsRenderSlots<'sidebar' | 'conversation' | 'rightbar' | 'shell.overlay' | 'oryh.business'> & PropsStore<ReturnType<typeof createFrameStore>> & PropsLocale<'oryh'>

/** Provide exactly one root, and retract service and child declarations together. */
export function registerFrame(ctx: Context): void {
  ctx.effect(() => {
    let actions: FrameActions | undefined
    const requireActions = () => { if (!actions) throw new Error('ORYH root is not mounted'); return actions }
    const layout: ILayout = {
      toggleSidebar: () => requireActions().toggleSidebar(),
      openRightbar: (track, fullscreen) => requireActions().openRightbar(track, fullscreen),
      closeRightbar: () => requireActions().closeRightbar(),
    }
    const removeService = ctx.reflect.provide('layout', layout)
    const removeRoot = ctx.slots.register({
      name: 'root', locale: 'oryh', store: createFrameStore,
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session-maybe' },
        rightbar: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'oryh.business': { kind: 'single', scope: 'root' },
      },
      inject: (bound: FrameActions) => { actions = bound; return {} },
    }, Frame)
    return () => { removeRoot(); actions = undefined; void removeService() }
  }, 'oryh root layout')
}

function Frame({ useStore, actions, renderSlot, SessionProvider, t }: FrameProps) {
  const state = useStore(s => s)
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => actions.measure(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(measure)
    measure(); observer.observe(element)
    return () => observer.disconnect()
  }, [actions])
  const compact = state.viewport < 1100 ? !state.narrowExpanded : state.collapsed
  const sidebarWidth = compact ? 56 : 208
  const pages = [
    ['my-open-todos', 'text8', IconChecklist],
    ['my-expense-claims', 'text10', IconReceipt],
    ['list-projects', 'text12', IconFolder],
    ['settings', 'text15', IconSettings],
  ] as const
  return <div ref={root} className="oryh-frame" data-compact={compact} data-focus={state.focus} data-chat={state.chatVisible}>
    <aside className="oryh-navigation" aria-label={t('businessNavigation')}>
      <div className="oryh-brand"><span>O</span>{!compact && <strong>ORYH <small>{t('workbench')}</small></strong>}</div>
      <nav className="oryh-menu" aria-label={t('text14')}>
        {pages.map(([page, label, Icon]) => <button key={page} title={t(label)} aria-label={t(label)} aria-current={state.page === page ? 'page' : undefined} onClick={() => actions.navigate(page)}><Icon size={19}/>{!compact && <span>{t(label)}</span>}</button>)}
      </nav>
      <div className="oryh-native-heading">{compact ? 'DS' : t('sessionsSettings')}</div>
      <div className="oryh-native-sidebar">{renderSlot('sidebar', { collapsed: compact, width: sidebarWidth })}</div>
    </aside>
    <div className="oryh-frame-toolbar">
      <button className="oryh-collapse" aria-label={t('toggleMenu')} onClick={actions.toggleSidebar}><IconLayoutSidebarLeftCollapse size={18}/></button>
      <span>{t('title')}</span>
      <div className="oryh-mobile-switch"><button aria-pressed={state.focus === 'business'} onClick={actions.showBusiness}>{t('businessView')}</button><button aria-pressed={state.focus === 'chat'} onClick={actions.showChat}>{t('assistant')}</button></div>
      <button className="oryh-chat-toggle" aria-pressed={state.chatVisible} onClick={actions.toggleChat}><IconMessage size={17}/>{state.chatVisible ? t('hideChat') : t('showChat')}</button>
    </div>
    <section className="oryh-business-seat" aria-label={t('businessView')}>{renderSlot('oryh.business', { page: state.page })}</section>
    <section className="oryh-chat-seat" aria-label={t('assistant')}>
      <header><strong>{t('assistant')}</strong><span>{t('nativeChat')}</span></header>
      <div className="oryh-chat-content">{renderSlot('conversation', {})}</div>
      <p className="oryh-chat-note">{t('chatBoundary')}</p>
    </section>
    <div className="oryh-artifact-seat"><SessionProvider>{renderSlot('rightbar', { width: Math.min(640, state.viewport), viewportWidth: state.viewport, canShow: state.viewport >= 700 })}</SessionProvider></div>
    <div className="oryh-shell-overlay" data-shell-overlay>{renderSlot('shell.overlay', {})}</div>
  </div>
}
