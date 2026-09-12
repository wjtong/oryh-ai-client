import {z} from 'zod'
import {createViewPreference} from './view-preferences.js'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { OperationId } from '@oryh/ai-client-core/types'
export type BusinessView = OperationId | import('@oryh/ai-client-core/types').RecordKind | 'settings' | 'timesheets' | 'timesheet-approvals'
export interface FrameIdentity { company: string; email: string; allowedPages?: string[] }
export interface FrameState {
  identity?: FrameIdentity | undefined
  /** Global central panel selected through the native sidebar; null keeps the Conversation. */
  panelInfo: { activePanelId: MainPanelId | null }
  page: BusinessView
  narrowExpanded: boolean
  collapsed: boolean
  focus: 'business' | 'chat'
  chatWidth: number
  chatVisible: boolean
  viewport: number
  rightbarShown: boolean
  rightbarTrack: boolean
  rightbarFullscreen: boolean
}
const framePreferenceSchema=z.object({
 page:z.enum(['my-open-todos','my-expense-claims','list-projects','sales-orders','inventory-items','inventory-item-details','shipments','settings','timesheets','timesheet-approvals']).catch('my-open-todos'),
 collapsed:z.boolean().catch(true), chatWidth:z.number().finite().min(280).max(3000).catch(360),
 chatVisible:z.boolean().catch(true), focus:z.enum(['business','chat']).catch('business'),
})
const frameDefaults={page:'my-open-todos' as const,collapsed:true,chatWidth:360,chatVisible:true,focus:'business' as const}
/** Persist display choices only; identity, viewport and native overlays stay transient. */
export function createFrameStore() {
  const preferences=createViewPreference('browser','frame',frameDefaults as z.infer<typeof framePreferenceSchema>,framePreferenceSchema)
  const handle=defineStore({
    init: (): FrameState => ({ narrowExpanded: false, viewport: 1280, rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false, panelInfo: { activePanelId: null }, ...preferences.getSnapshot() }),
    actions: {
      selectPanel: (d, panelId: MainPanelId | null) => { d.panelInfo.activePanelId = panelId },
      // A panel whose plugin unloaded must not stay selected over an empty main slot.
      retainMainPanels: (d, panelIds: readonly string[]) => {
        if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) d.panelInfo.activePanelId = null
      },
      setIdentity: (d, identity: FrameIdentity | undefined) => { d.identity = identity },
      navigate: (d, page: BusinessView) => { d.page = page; d.focus = 'business'; d.narrowExpanded = false },
      toggleSidebar: d => { if (d.viewport < 1100) d.narrowExpanded = !d.narrowExpanded; else d.collapsed = !d.collapsed },
      showBusiness: d => { d.focus = 'business' },
      showChat: d => { d.focus = 'chat'; d.chatVisible = true },
      toggleChat: d => { d.chatVisible = !d.chatVisible; if (!d.chatVisible) d.focus = 'business' },
      setChatWidth: (d, width:number) => { if(Number.isFinite(width)) d.chatWidth = Math.round(Math.max(280,Math.min(width,3000))) },
      measure: (d, width: number) => { if (width > 0) { if ((width < 1100) !== (d.viewport < 1100)) d.narrowExpanded = false; d.viewport = width } },
      openRightbar: (d, track: boolean, fullscreen: boolean) => { d.rightbarShown = true; d.rightbarTrack = track; d.rightbarFullscreen = fullscreen },
      closeRightbar: d => { d.rightbarShown = false; d.rightbarTrack = false; d.rightbarFullscreen = false },
    },
  })
  return {...handle,create(scopeKey?:string){
    const instance=handle.create(scopeKey)
    const unsubscribe=instance.subscribe(()=>{
      const {page,collapsed,chatWidth,chatVisible,focus}=instance.getSnapshot()
      const next={page,collapsed,chatWidth,chatVisible,focus}
      if(JSON.stringify(next)!==JSON.stringify(preferences.getSnapshot()))preferences.set(next)
    })
    return {...instance,dispose:()=>{unsubscribe()}}
  }}
}
