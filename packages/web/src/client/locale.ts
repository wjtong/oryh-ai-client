import { createContext, useContext, useMemo } from 'react'
import { zhCN } from './copy.js'
import { businessZh, type BusinessText } from './business-locales.js'
export const dictionaries = { ...businessZh, ...zhCN, businessNavigation: '业务导航', workbench: '工作台', sessionsSettings: '会话与设置', toggleMenu: '收起或展开菜单', businessView: '业务视图', assistant: 'AI 助手', nativeChat: 'Harness 原生会话', hideChat: '收起对话', showChat: '展开对话', chatBoundary: '业务 AI 联动尚未启用；请在业务页面填写和确认。', open: 'ORYH 业务', close: '返回对话', title: 'ORYH 企业工作台' }
export type OryhKey = keyof typeof dictionaries
export type OryhText = (key: OryhKey, params?: Record<string, unknown>) => string
export type BusinessCopy = Record<keyof typeof zhCN, string>
export const LocaleContext = createContext<OryhText | undefined>(undefined)
function useText(): OryhText {
  const t = useContext(LocaleContext)
  if (!t) throw new Error('ORYH locale is not mounted')
  return t
}
export function useBusinessText(): BusinessText { return useText() }
export function useBusinessCopy(): BusinessCopy {
  const t = useText()
  return useMemo(() => Object.fromEntries(Object.keys(zhCN).map(key => [key, t(key as keyof typeof zhCN)])) as BusinessCopy, [t])
}
