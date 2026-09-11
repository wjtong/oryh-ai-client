/** An external root provider: only public slot, store, locale and layout contracts. */
import type { Context } from '@deepseek-ai/cordis'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { BoundActions, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { IconChecklist, IconReceipt, IconFolder, IconSettings, IconLayoutSidebarLeftCollapse, IconMessage } from '@tabler/icons-react'
import { createFrameStore, type BusinessView, type FrameIdentity } from './layout-store.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'oryh.business': { kind: 'single'; scope: 'root'; owner: { page: BusinessView; navigate: (page:BusinessView)=>void; onIdentity: (identity:FrameIdentity|undefined)=>void } }
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
  const maxChatWidth = Math.max(280,state.viewport-(state.viewport<1100?56:sidebarWidth)-320)
  const chatWidth = Math.min(state.chatWidth,maxChatWidth)
  const drag = useRef<{x:number;width:number;pointer:number}|undefined>(undefined)
  const [dragging,setDragging] = useState(false)
  const pages = [
    ['my-open-todos', 'text8', IconChecklist],
    ['my-expense-claims', 'text10', IconReceipt],
    ['timesheets', 'tsMine', IconChecklist],
    ['timesheet-approvals', 'tsApprovals', IconChecklist],
    ['list-projects', 'text12', IconFolder],
    ['sales-orders','salesOrders',IconReceipt],
    ['inventory-items','inventoryItems',IconFolder],
    ['inventory-item-details','inventoryDetails',IconChecklist],
    ['shipments','shipments',IconReceipt],
    ['settings', 'text15', IconSettings],
  ] as const
  return <div ref={root} className="oryh-frame" data-compact={compact} data-focus={state.focus} data-chat={state.chatVisible} data-resizing={dragging} style={{'--oryh-chat-width':`${chatWidth}px`} as CSSProperties}>
    <aside className="oryh-navigation" aria-label={t('businessNavigation')}>
      <div className="oryh-brand"><span>O</span>{!compact && <strong>ORYH <small>{t('workbench')}</small></strong>}</div>
      <nav className="oryh-menu" aria-label={t('text14')}>
        {pages.filter(([page])=>page==='settings'||state.identity?.allowedPages?.includes(page)).map(([page, label, Icon]) => <button key={page} title={t(label)} aria-label={t(label)} aria-current={state.page === page ? 'page' : undefined} onClick={() => actions.navigate(page)}><Icon size={19}/>{!compact && <span>{t(label)}</span>}</button>)}
      </nav>
      <div className="oryh-native-heading">{compact ? 'DS' : t('sessionsSettings')}</div>
      <div className="oryh-native-sidebar">{renderSlot('sidebar', { collapsed: compact, width: sidebarWidth })}</div>
    </aside>
    <div className="oryh-frame-toolbar">
      <button className="oryh-collapse" title={compact?t('expandMenu'):t('collapseMenu')} aria-label={compact?t('expandMenu'):t('collapseMenu')} aria-expanded={!compact} onClick={actions.toggleSidebar}><IconLayoutSidebarLeftCollapse size={18}/></button>
      <div className="oryh-global-heading"><span className="oryh-global-title">{t('title')}</span>{state.identity&&<div className="oryh-global-identity"><strong title={state.identity.company}>{state.identity.company}</strong><span title={state.identity.email}>{state.identity.email}</span></div>}</div>
      <div className="oryh-mobile-switch"><button aria-pressed={state.focus === 'business'} onClick={actions.showBusiness}>{t('businessView')}</button><button aria-pressed={state.focus === 'chat'} onClick={actions.showChat}>{t('assistant')}</button></div>
      <div className="oryh-chat-controls"><button className="oryh-chat-toggle" aria-pressed={state.chatVisible} onClick={actions.toggleChat}><IconMessage size={17}/>{state.chatVisible ? t('hideChat') : t('showChat')}</button></div>
    </div>
    <section className="oryh-business-seat" aria-label={t('businessView')}>{renderSlot('oryh.business', { page: state.page, navigate: actions.navigate, onIdentity: actions.setIdentity })}</section>
    {state.chatVisible&&<div className="oryh-chat-resizer" role="separator" aria-label="调整 Chat 宽度" aria-orientation="vertical" aria-controls="oryh-chat-panel" aria-valuemin={280} aria-valuemax={maxChatWidth} aria-valuenow={chatWidth} tabIndex={0} title="拖动调整 Chat 宽度，双击恢复默认"
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,width:chatWidth,pointer:e.pointerId};setDragging(true)}}
      onPointerMove={e=>{if(drag.current?.pointer===e.pointerId)actions.setChatWidth(Math.min(maxChatWidth,drag.current.width+drag.current.x-e.clientX))}}
      onPointerUp={e=>{if(drag.current?.pointer===e.pointerId){drag.current=undefined;setDragging(false);e.currentTarget.releasePointerCapture(e.pointerId)}}}
      onPointerCancel={()=>{drag.current=undefined;setDragging(false)}} onLostPointerCapture={()=>{drag.current=undefined;setDragging(false)}}
      onDoubleClick={()=>actions.setChatWidth(360)}
      onKeyDown={e=>{const widths:Record<string,number>={ArrowLeft:chatWidth+20,ArrowRight:chatWidth-20,Home:280,End:maxChatWidth};if(e.key in widths){e.preventDefault();actions.setChatWidth(Math.min(maxChatWidth,widths[e.key]!))}}}/>}
    <section id="oryh-chat-panel" className="oryh-chat-seat" aria-label={t('assistant')}>
      <header><strong>{t('assistant')}</strong><span>{t('nativeChat')}</span></header>
      <div className="oryh-chat-content">{renderSlot('conversation', {})}</div>
    </section>
    <div className="oryh-artifact-seat"><SessionProvider>{renderSlot('rightbar', { width: Math.min(640, state.viewport), viewportWidth: state.viewport, canShow: state.viewport >= 700 })}</SessionProvider></div>
    <div className="oryh-shell-overlay" data-shell-overlay>{renderSlot('shell.overlay', {})}</div>
  </div>
}
