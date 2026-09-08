/** ORYH business views mounted into public Harness slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { useState, useSyncExternalStore } from 'react'
import { TYPERT_REMOTE } from '@oryh/dsh-host/remote'
import { PortalMountNodeProvider } from '@fluentui/react-components'
import { App } from './app.js'
import { createOryhRemote, RemoteContext } from './remote.js'
import style from './styles.css'
import { registerFrame } from './layout.js'
import { presentTheme } from './theme.js'

import { LocaleContext, dictionaries, type OryhKey } from './locale.js'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { oryh: OryhKey } }
export const inject = ['slots', 'remote', 'locale', 'theme']

/** Mount generated Remote and reversible root-scoped UI; no Session data is sent to ORYH. */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register('oryh', { zh: dictionaries, en: dictionaries }), 'oryh locale')
  ctx.effect(() => {
    const sheet = document.createElement('style')
    sheet.textContent = style
    sheet.dataset.oryh = 'business'
    document.head.append(sheet)
    return () => sheet.remove()
  }, 'oryh scoped styles')
  presentTheme(ctx)
  registerFrame(ctx)
  await ctx.remote.$mount(TYPERT_REMOTE)
  await ctx.inject(['remote.oryh'], registerUi)
}

function registerUi(ctx: Context): void {
  const remote = createOryhRemote(ctx.remote)
  const subscribeTheme = (listener: () => void) => ctx.on('theme/change', listener)
  const getTheme = () => ctx.theme.getTheme()
  ctx.slots.inject('oryh.business', () => ctx.slots.register({
    name: 'oryh.business', locale: 'oryh',
  }, function BusinessView({ t, page }) {
    const theme = useSyncExternalStore(subscribeTheme, getTheme)
    const [portal, setPortal] = useState<HTMLDivElement | null>(null)
    return <div className="oryh-business-root" data-theme={theme.active.colorScheme}>
      <PortalMountNodeProvider value={portal ?? undefined}><RemoteContext.Provider value={remote}><LocaleContext.Provider value={t}><App dark={theme.active.colorScheme === 'dark'} page={page}/></LocaleContext.Provider></RemoteContext.Provider></PortalMountNodeProvider>
      <div ref={setPortal} className="oryh-business-portals"/>
    </div>
  }))
}
