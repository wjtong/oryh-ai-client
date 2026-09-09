import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatPageRequest, ChatNavigation as Navigation } from '@oryh/dsh-host/types'
import type { BusinessView } from './layout-store.js'
import type { ConnectionId } from '@oryh/ai-client-core/types'
import { BusinessSessionContext } from './todo-chat.js'
import { useOryhRemote } from './remote.js'
export const BusinessNavigationContext=createContext<(page:BusinessView)=>void>(()=>{})
/** Root-lived bridge: an authenticated Session can open a view without first selecting a menu. */
export function ChatNavigation({connectionId,onOpen,page,context}:{page:BusinessView;context?:ChatPageRequest['context'];connectionId:ConnectionId;onOpen:(command:Navigation)=>void}){
  const api=useOryhRemote(),sessionId=useContext(BusinessSessionContext),callback=useRef(onOpen)
  const [viewId]=useState(()=>crypto.randomUUID()),homeReady=useRef<Promise<unknown>>(Promise.resolve()),version=useRef({json:'',revision:0})
  const json=JSON.stringify({page,context})
  if(version.current.json!==json)version.current={json,revision:version.current.revision+1}
  const revision=version.current.revision
  callback.current=onOpen
  useEffect(()=>{
    if(!sessionId)return
    let live=true,seen='',timer:ReturnType<typeof setTimeout>|undefined
    async function poll(){
      try{const n=await api.chatHomePoll({sessionId:sessionId!,connectionId});if(live&&n&&n.id!==seen){seen=n.id;if(n.target!=='todo')callback.current(n)}}catch{return}
      if(live)timer=setTimeout(()=>void poll(),600)
    }
    function bindHome(){homeReady.current=api.chatSelect({sessionId:sessionId!,connectionId,homeOnly:true});void homeReady.current.then(()=>{if(live)void poll()}).catch(()=>{if(live)timer=setTimeout(bindHome,500)})}
    bindHome()
    return()=>{live=false;if(timer)clearTimeout(timer);void api.chatHomeClear(sessionId).catch(()=>{})}
  },[api,sessionId,connectionId])
  useLayoutEffect(()=>{
    if(!sessionId)return
    let live=true,timer:ReturnType<typeof setTimeout>|undefined
    async function sync(){try{if(live)await api.chatPageSync({sessionId:sessionId!,connectionId,viewId,revision,page,...(context?{context}:{})})}catch{if(live)timer=setTimeout(()=>void sync(),500)}}
    void sync()
    return()=>{live=false;if(timer)clearTimeout(timer)}
  },[api,sessionId,connectionId,viewId,revision])
  return null
}
