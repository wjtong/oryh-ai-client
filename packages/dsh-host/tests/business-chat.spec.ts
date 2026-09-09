import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe,it,expect } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { OryhClientController,TodoDetailService } from '@oryh/ai-client-core'
import { BusinessChat } from '../src/business-chat.js'
const connectionId='c' as import('@oryh/ai-client-core').ConnectionId
async function setup(api?:import('@oryh/ai-client-core/types').OryhTimesheetRemote){
 const directory=await mkdtemp(join(tmpdir(),'oryh-chat-'))
 const agent={id:'s',status:'idle',session:{header:{isSeeded:false,parentSession:undefined as string|undefined}}}
 const identity={id:connectionId,origin:'https://oryh.example',identity:{tenant:{id:'tenant'},user:{id:'user',employeeId:'employee'}}}
 let read=async()=>({todoId:'todo',title:'业务待办',entityType:'sales_quotation',entityId:'q',fetchedAt:'now',sections:[]})
 const ctx={agents:{get:(id:string)=>id==='s'?agent:undefined}} as unknown as Context
 const controller={verifyConnection:async()=>identity,listConnections:async()=>[identity]} as unknown as OryhClientController
 const details={read:()=>read()} as unknown as TodoDetailService
 const create=()=>new BusinessChat(ctx,controller,details,directory,api)
 return {chat:create(),create,identity,agent,setRead:(fn:typeof read)=>{read=fn},close:()=>rm(directory,{recursive:true,force:true})}
}
describe('session business binding',()=>{
 it('persists enterprise and employee binding across plugin restart, and requires an explicit target',async()=>{
  const f=await setup();try{await expect(f.chat.read('s')).rejects.toThrow(/尚未同步/);expect((await f.chat.select({sessionId:'s',connectionId,todoId:'todo'})).ready).toBe(true);expect((await f.chat.read('s')).entityId).toBe('q');f.identity.identity.tenant.id='other';await expect(f.create().select({sessionId:'s',connectionId,todoId:'todo'})).rejects.toThrow(/其他企业/)}finally{await f.close()}
 })
 it('rejects forked sessions and busy selection, invalidating the previous target',async()=>{
  const f=await setup();try{await f.chat.select({sessionId:'s',connectionId,todoId:'todo'});f.agent.status='running';await expect(f.chat.select({sessionId:'s',connectionId,todoId:'other'})).rejects.toThrow(/正在回答/);await expect(f.chat.read('s')).rejects.toThrow(/尚未同步/);f.agent.status='idle';f.agent.session.header.parentSession='parent';await expect(f.chat.select({sessionId:'s',connectionId,todoId:'todo'})).rejects.toThrow(/分支/)}finally{await f.close()}
 })
 it('discards an in-flight result when the selected page is cleared',async()=>{
  const f=await setup();try{await f.chat.select({sessionId:'s',connectionId,todoId:'todo'});let release!:()=>void;f.setRead(async()=>{await new Promise<void>(r=>{release=r});return {todoId:'todo',title:'old',entityType:'sales_quotation',entityId:'q',fetchedAt:'now',sections:[]}});const result=f.chat.read('s');await new Promise(r=>setTimeout(r,0));f.chat.clear('s');release();await expect(result).rejects.toThrow(/页面已改变/)}finally{await f.close()}
 })
})

describe('chat-first navigation',()=>{
 it('binds the home without erasing the current todo',async()=>{const f=await setup();try{await f.chat.select({sessionId:'s',connectionId,todoId:'todo'});await f.chat.select({sessionId:'s',connectionId,homeOnly:true});expect((await f.chat.read('s')).todoId).toBe('todo')}finally{await f.close()}})
 it('allows only the issued navigation during an active model turn and awaits the actual form',async()=>{const f=await setup();try{
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true});f.agent.status='running'
  const pending=f.chat.openTimesheet('s',new AbortController().signal)
  await new Promise(r=>setTimeout(r,0));const n=await f.chat.homePoll({sessionId:'s',connectionId});expect(n).toBeDefined()
  await expect(f.chat.select({sessionId:'s',connectionId,timesheetPage:'page',navigationId:'fake'})).rejects.toThrow(/正在回答/)
  await f.chat.select({sessionId:'s',connectionId,timesheetPage:'page',navigationId:n!.id})
  await f.chat.timesheet.sync({sessionId:'s',connectionId,pageKey:'page',navigationId:n!.id,revision:1,manager:false,fields:{period_start:'',period_end:'',source_report_text:'',entries:[]}})
  expect(await pending).toContain('表单已打开');expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeUndefined()
 }finally{await f.close()}})
 it('refuses navigation when enterprise identity changes',async()=>{const f=await setup();try{await f.chat.select({sessionId:'s',connectionId,homeOnly:true});f.identity.identity.user.employeeId='other';await expect(f.chat.openTimesheet('s',new AbortController().signal)).rejects.toThrow(/身份/)}finally{await f.close()}})
 it('cancels pending navigation on abort',async()=>{const f=await setup();try{await f.chat.select({sessionId:'s',connectionId,homeOnly:true});const c=new AbortController();c.abort();await expect(f.chat.openTimesheet('s',c.signal)).rejects.toThrow();expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeUndefined()}finally{await f.close()}})
})


describe('open existing timesheet navigation',()=>{
 it.each([false,true])('validates the target before navigation and awaits the matching detail (manager=%s)',async(manager)=>{
  const calls:unknown[]=[]
  const api={timesheetDetail:async(...args:unknown[])=>{calls.push(args);return {header:{id:'header'},canEdit:!manager}}} as unknown as import('@oryh/ai-client-core/types').OryhTimesheetRemote
  const f=await setup(api)
  try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true});f.agent.status='running'
   const pending=f.chat.openTimesheet('s',new AbortController().signal,'header',manager?'todo':'')
   await new Promise(r=>setTimeout(r,0));const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
   expect(calls).toEqual([[connectionId,'header',manager?'todo':undefined]])
   expect(n.headerId).toBe('header');expect(n.manager).toBe(manager)
   await expect(f.chat.select({sessionId:'s',connectionId,timesheetPage:'page',navigationId:n.id,manager:!manager})).rejects.toThrow(/正在回答/)
   await f.chat.select({sessionId:'s',connectionId,timesheetPage:'page',navigationId:n.id,manager})
   await f.chat.timesheet.sync({sessionId:'s',connectionId,pageKey:'page',navigationId:n.id,revision:1,manager,headerId:'header',...(manager?{todoId:'todo'}:{})})
   expect(await pending).toContain('指定工时已在右侧打开')
  }finally{await f.close()}
 })
 it('does not publish navigation for an inaccessible record',async()=>{
  const api={timesheetDetail:async()=>{throw Error('没有权限')}} as unknown as import('@oryh/ai-client-core/types').OryhTimesheetRemote
  const f=await setup(api);try{await f.chat.select({sessionId:'s',connectionId,homeOnly:true});await expect(f.chat.openTimesheet('s',new AbortController().signal,'other')).rejects.toThrow('没有权限');expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeUndefined()}finally{await f.close()}
 })
})

describe('visible todo navigation',()=>{
 const visibleTodos=[{id:'second-on-server',title:'当前第一条'},{id:'first-on-server',title:'当前第二条'}]
 it('uses visible order and waits for the exact authorized detail to open',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   await f.chat.select({sessionId:'s',connectionId,visibleTodos,listRevision:'v1'})
   expect((await f.chat.visibleTodos('s')).items[0]).toEqual({...visibleTodos[0],position:1})
   f.agent.status='running'
   const pending=f.chat.openTodo('s',1,'v1',new AbortController().signal)
   await new Promise(r=>setTimeout(r,0))
   const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
   expect(n.todoId).toBe('second-on-server');expect(n.target).toBe('todo')
   await expect(f.chat.select({sessionId:'s',connectionId,todoId:'first-on-server',navigationId:n.id})).rejects.toThrow(/正在回答/)
   const selected=await f.chat.select({sessionId:'s',connectionId,todoId:n.todoId!,navigationId:n.id})
   expect(selected.document).toBeDefined()
   expect(await pending).toEqual(selected.document)
  }finally{await f.close()}
 })
 it('rejects old versions, invalid positions and lists no longer visible',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,visibleTodos,listRevision:'v2'})
   await expect(f.chat.openTodo('s',1,'v1',new AbortController().signal)).rejects.toThrow(/列表已改变/)
   for(const index of [0,3,1.5])await expect(f.chat.openTodo('s',index,'v2',new AbortController().signal)).rejects.toThrow(/序号/)
   f.chat.clear('s');await expect(f.chat.visibleTodos('s')).rejects.toThrow(/没有已同步/)
  }finally{await f.close()}
 })
 it('rejects inaccessible targets before issuing a navigation command',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   await f.chat.select({sessionId:'s',connectionId,visibleTodos,listRevision:'v1'})
   f.setRead(async()=>{throw Error('不属于当前员工')})
   await expect(f.chat.openTodo('s',1,'v1',new AbortController().signal)).rejects.toThrow(/不属于/)
   expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeUndefined()
  }finally{await f.close()}
 })
})

it('refreshes list context during a model turn and invalidates its old ordinal',async()=>{
 const f=await setup();try{
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
  await f.chat.select({sessionId:'s',connectionId,visibleTodos:[{id:'old',title:'old'}],listRevision:'before'})
  f.agent.status='running'
  await f.chat.select({sessionId:'s',connectionId,visibleTodos:[{id:'new',title:'new'}],listRevision:'after'})
  await expect(f.chat.openTodo('s',1,'before',new AbortController().signal)).rejects.toThrow(/列表已改变/)
  expect((await f.chat.visibleTodos('s')).items[0]!.id).toBe('new')
 }finally{await f.close()}
})

describe('root page context',()=>{
 it('switches from timesheet to projects during a model turn and rejects late old bindings',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'view',revision:1,page:'timesheets'})
   await f.chat.select({sessionId:'s',connectionId,timesheetPage:'form'})
   await f.chat.timesheet.sync({sessionId:'s',connectionId,pageKey:'form',revision:1,manager:false,fields:{period_start:'',period_end:'',source_report_text:'',entries:[]}})
   f.agent.status='running'
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'view',revision:2,page:'list-projects',context:{key:'list-projects:list',title:'项目列表',detail:'筛选：技改',scope:'7 条'}})
   expect(f.chat.currentPage('s')).toMatchObject({page:'list-projects',capabilities:{create:true}})
   expect(f.chat.timesheet.current('s')).toBeUndefined()
   await expect(f.chat.timesheet.read('s')).rejects.toThrow()
   await expect(f.chat.select({sessionId:'s',connectionId,timesheetPage:'form'})).rejects.toThrow(/旧页面/)
   f.chat.clear('s');expect(f.chat.currentPage('s').page).toBe('list-projects')
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'view',revision:1,page:'timesheets'})
   expect(f.chat.currentPage('s').page).toBe('list-projects')
  }finally{await f.close()}
 })
 it('does not revive an old todo detail after the user leaves its page',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'view',revision:1,page:'my-open-todos'})
   let release!:()=>void,started!:()=>void
   const reading=new Promise<void>(r=>{started=r})
   f.setRead(async()=>{started();await new Promise<void>(r=>{release=r});return {todoId:'todo',title:'old',entityType:'sales_quotation',entityId:'q',fetchedAt:'now',sections:[]}})
   const pending=f.chat.select({sessionId:'s',connectionId,todoId:'todo'})
   await reading
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'view',revision:2,page:'list-projects'})
   release();await expect(pending).rejects.toThrow(/旧页面/)
   expect(f.chat.currentPage('s').title).toBe('项目列表')
  }finally{await f.close()}
 })
})
