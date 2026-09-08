import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { OperationId } from '@oryh/ai-client-core/types'
export type BusinessView = OperationId | 'settings'
export interface FrameState {
  page: BusinessView
  narrowExpanded: boolean
  collapsed: boolean
  focus: 'business' | 'chat'
  chatVisible: boolean
  viewport: number
  rightbarShown: boolean
  rightbarTrack: boolean
  rightbarFullscreen: boolean
}
/** Transient root state; deliberately independent of the selected Session. */
export function createFrameStore() {
  return defineStore({
    init: (): FrameState => ({ page: 'my-open-todos', narrowExpanded: false, collapsed: false, focus: 'business', chatVisible: true, viewport: 1280, rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false }),
    actions: {
      navigate: (d, page: BusinessView) => { d.page = page; d.focus = 'business'; d.narrowExpanded = false },
      toggleSidebar: d => { if (d.viewport < 1100) d.narrowExpanded = !d.narrowExpanded; else d.collapsed = !d.collapsed },
      showBusiness: d => { d.focus = 'business' },
      showChat: d => { d.focus = 'chat'; d.chatVisible = true },
      toggleChat: d => { d.chatVisible = !d.chatVisible },
      measure: (d, width: number) => { if (width > 0) { if ((width < 1100) !== (d.viewport < 1100)) d.narrowExpanded = false; d.viewport = width } },
      openRightbar: (d, track: boolean, fullscreen: boolean) => { d.rightbarShown = true; d.rightbarTrack = track; d.rightbarFullscreen = fullscreen },
      closeRightbar: d => { d.rightbarShown = false; d.rightbarTrack = false; d.rightbarFullscreen = false },
    },
  })
}
