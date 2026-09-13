import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatPageRequest, ChatNavigation as Navigation, UserViewSummary } from '@oryh/dsh-host/types'
import type { BusinessView } from './layout-store.js'
import type { ConnectionId } from '@oryh/ai-client-foundation'
import { BusinessSessionContext } from './todo-chat.js'
import { useCommands } from './command-stream.js'
import { useOryhRemote } from './remote.js'
export const BusinessNavigationContext=createContext<(page:BusinessView)=>void>(()=>{})
/**
 * Root-lived bridge: an authenticated Session can open a view without first selecting a menu.
 *
 * `page` is what the Host checks permissions against, so a person's own menu entry reports the list it
 * narrows rather than its `view:` id — the entry itself rides in `context.view`, and the full set of
 * entries in `views`, which is how the model learns their names.
 */
export function ChatNavigation({connectionId,onOpen,page,context,views}:{page:ChatPageRequest['page'];context?:ChatPageRequest['context'];views:readonly UserViewSummary[];connectionId:ConnectionId;onOpen:(command:Navigation)=>void}){
  const api=useOryhRemote(),sessionId=useContext(BusinessSessionContext),callback=useRef(onOpen)
  const [viewId]=useState(()=>crypto.randomUUID()),version=useRef({json:'',revision:0}),seen=useRef('')
  const [navigationId,setNavigationId]=useState<string>()
  // `views` belongs in the version: adding a menu entry changes nothing else on the page, and the Host
  // waits for it to arrive before it tells the model the entry exists.
  const json=JSON.stringify({page,context,navigationId,views})
  if(version.current.json!==json)version.current={json,revision:version.current.revision+1}
  const revision=version.current.revision
  callback.current=onOpen
  const command=useCommands().commands.navigation
  useEffect(()=>{
    if(!sessionId||!command||command.id===seen.current)return
    seen.current=command.id
    if(command.target==='todo')return
    callback.current(command)
    if(command.target==='page'||command.target==='columns'||command.target==='filters'||command.target==='menu'||command.target==='view')setNavigationId(command.id)
  },[sessionId,command])
  useLayoutEffect(()=>{
    if(!sessionId)return
    let live=true,timer:ReturnType<typeof setTimeout>|undefined
    async function sync(){try{if(live)await api.chatPageSync({sessionId:sessionId!,connectionId,viewId,revision,page,views:[...views],...(navigationId?{navigationId}:{}),...(context?{context}:{})})}catch{if(live)timer=setTimeout(()=>void sync(),500)}}
    void sync()
    return()=>{live=false;if(timer)clearTimeout(timer)}
  },[api,sessionId,connectionId,viewId,revision])
  return null
}
