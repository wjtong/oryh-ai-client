// @vitest-environment jsdom
import {act,createElement as h} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import {ChatNavigation} from './chat-navigation.js'
import {RemoteContext} from './remote.js'
import {BusinessSessionContext} from './todo-chat.js'
vi.mock('./todo-chat.js',async()=>({BusinessSessionContext:(await import('react')).createContext<string|undefined>(undefined)}))
it('publishes every menu change and selection context through the root bridge',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const sync=vi.fn(async()=>{}),api={chatSelect:async()=>({}),chatPageSync:sync,chatHomePoll:async()=>undefined,chatHomeClear:async()=>{}}
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node)
 try{
  for(const page of ['timesheets','list-projects','my-expense-claims','settings','my-open-todos','timesheet-approvals'] as const){
   await act(async()=>root.render(h(RemoteContext.Provider,{value:api as never},h(BusinessSessionContext.Provider,{value:'s'},h(ChatNavigation,{connectionId:'c' as never,page,views:[],onOpen:()=>{},context:{key:page+':list',title:page,detail:'filtered',scope:'current'}})))))
   expect(sync.mock.lastCall?.[0]).toMatchObject({sessionId:'s',page,context:{key:page+':list'}})
  }
  const revisions=sync.mock.calls.map(c=>c[0].revision)
  expect(revisions).toEqual([...revisions].sort((a,b)=>a-b))
  // A menu entry changes nothing else on the page, yet the Host waits for it before telling the model
  // it exists — so adding one alone must produce a fresh sync that carries it.
  const view={id:'0b7c1f0e-2d1a-4d5e-9a3b-6c8d9e0f1a2b',label:'入库单',kind:'shipments' as const,filters:{direction:'inbound'}}
  const before=sync.mock.calls.length
  await act(async()=>root.render(h(RemoteContext.Provider,{value:api as never},h(BusinessSessionContext.Provider,{value:'s'},h(ChatNavigation,{connectionId:'c' as never,page:'timesheet-approvals',views:[view],onOpen:()=>{},context:{key:'timesheet-approvals:list',title:'timesheet-approvals',detail:'filtered',scope:'current'}})))))
  expect(sync.mock.calls.length).toBeGreaterThan(before)
  expect(sync.mock.lastCall?.[0]).toMatchObject({page:'timesheet-approvals',views:[view]})
 }finally{await act(async()=>root.unmount());node.remove()}
})
