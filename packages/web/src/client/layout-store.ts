import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { OperationId } from '@oryh/ai-client-core/types'
export type BusinessView = OperationId | import('@oryh/ai-client-core/types').RecordKind | 'settings' | 'timesheets' | 'timesheet-approvals'
export interface FrameIdentity { company: string; email: string }
export interface FrameState {
  identity?: FrameIdentity | undefined
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
/** Transient root state; deliberately independent of the selected Session. */
export function createFrameStore() {
  return defineStore({
    init: (): FrameState => ({ page: 'my-open-todos', narrowExpanded: false, collapsed: true, focus: 'business', chatWidth:360, chatVisible: true, viewport: 1280, rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false }),
    actions: {
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
}
