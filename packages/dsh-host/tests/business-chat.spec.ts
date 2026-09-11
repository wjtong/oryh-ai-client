import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe,it,expect,vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { OryhClientController,TodoDetailService } from '@oryh/ai-client-core'
import { BusinessChat } from '../src/business-chat.js'
const connectionId='c' as import('@oryh/ai-client-core').ConnectionId
async function setup(api?:import('@oryh/ai-client-core/types').OryhTimesheetRemote){
 const directory=await mkdtemp(join(tmpdir(),'oryh-chat-'))
 const agent={id:'s',status:'idle',session:{header:{isSeeded:false,parentSession:undefined as string|undefined}}}
 const identity={id:connectionId,origin:'https://oryh.example',identity:{permissions:['master_data.manage','expense.submit_own','timesheet.submit_own','approval.record','order.submit_own','inventory.manage'],tenant:{id:'tenant'},user:{id:'user',employeeId:'employee'}}}
 let read=async()=>({todoId:'todo',title:'业务待办',entityType:'sales_quotation',entityId:'q',fetchedAt:'now',sections:[]})
 const ctx={agents:{get:(id:string)=>id==='s'?agent:undefined}} as unknown as Context
 const controller={verifyConnection:async()=>identity,listConnections:async()=>[identity]} as unknown as OryhClientController
 const details={read:()=>read()} as unknown as TodoDetailService
 const create=()=>new BusinessChat(ctx,controller,details,directory,api)
 return {ctx,chat:create(),create,identity,agent,setRead:(fn:typeof read)=>{read=fn},close:()=>rm(directory,{recursive:true,force:true})}
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
   await new Promise(r=>setTimeout(r,0));await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
  const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
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
   await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
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

describe('live page background and navigation',()=>{
 it('includes the latest list snapshot and requires the navigation acknowledgement',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'list-projects',context:{key:'list',title:'项目',detail:'筛选',scope:'当前页',content:'项目甲'}})
   expect(f.chat.currentPage('s').context?.content).toBe('项目甲')
   const pending=f.chat.navigate('s','my-expense-claims',new AbortController().signal)
   await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
    const command=(await f.chat.homePoll({sessionId:'s',connectionId}))!
   expect(command.target).toBe('page')
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:'my-expense-claims',navigationId:command.id,context:{key:'expenses',title:'费用',detail:'',scope:'',content:'费用乙'}})
   expect(JSON.parse(await pending).context.content).toBe('费用乙')
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'list-projects'})
   expect(f.chat.currentPage('s').page).toBe('my-expense-claims')
  }finally{await f.close()}
 })
 it('publishes current project fields without confirmation credentials and clears them on leaving',async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'list-projects'})
   const fields={project_name:'人工输入',project_code:'',client:'',start_date:'',end_date:''}
   f.chat.project.sync({sessionId:'s',connectionId,pageKey:'p',revision:1,fields,busy:false})
   expect(f.chat.currentPage('s').visible).toMatchObject({fields,unsaved:true})
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:'settings'})
   expect(f.chat.currentPage('s').visible).toBeUndefined()
  }finally{await f.close()}
 })
})

it('accepts manual page selection during a turn only when the root page matches',async()=>{
 const f=await setup();try{
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'my-open-todos'})
  f.agent.status='running'
  expect((await f.chat.select({sessionId:'s',connectionId,todoId:'todo'})).ready).toBe(true)
  expect(f.chat.currentPage('s').visible).toMatchObject({document:{todoId:'todo'}})
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:'list-projects'})
  await expect(f.chat.select({sessionId:'s',connectionId,todoId:'todo'})).rejects.toThrow(/旧页面/)
 }finally{await f.close()}
})

it('changes project columns only after matching page acknowledgement',async()=>{
 const f=await setup();try{
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
  const context={key:'list-projects:list',title:'项目',detail:'',scope:'',columns:['name','status'] as import('../src/types.js').ProjectColumn[]}
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'list-projects',context})
  await expect(f.chat.configureProjectColumns('s',['name','password'],new AbortController().signal)).rejects.toThrow(/列配置/)
  const pending=f.chat.configureProjectColumns('s',['name','createdAt'],new AbortController().signal)
  await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
  const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:'list-projects',navigationId:n.id,context:{...context,columns:['name','createdAt']}})
  expect(await pending).toContain('显示列已更新')
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:3,page:'timesheets'})
  await expect(f.chat.configureProjectColumns('s',['name'],new AbortController().signal)).rejects.toThrow(/项目列表/)
 }finally{await f.close()}
})

for(const kind of ['sales-orders','inventory-items','inventory-item-details','shipments'] as const){
 it(`updates ${kind} columns through acknowledged plugin navigation`,async()=>{
  const f=await setup();try{
   await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
   const context={key:`${kind}:list`,title:kind,detail:'',scope:'',columns:['id']}
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:kind,context})
   for(const columns of [[],['password'],['__proto__'],['id','id']])await expect(f.chat.configureRecordColumns('s',columns,new AbortController().signal)).rejects.toThrow(/列配置/)
   const pending=f.chat.configureRecordColumns('s',['id'],new AbortController().signal)
   await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
  const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
   expect(n).toMatchObject({target:'columns',page:kind,columns:['id']})
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:kind,navigationId:n.id,context})
   expect(await pending).toContain('显示列已更新')
   const cancelled=f.chat.configureRecordColumns('s',['id'],new AbortController().signal)
   f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:3,page:'timesheets'})
   await expect(cancelled).rejects.toThrow(/页面已变化/)
   await expect(f.chat.configureRecordColumns('s',['id'],new AbortController().signal)).rejects.toThrow(/列表/)
  }finally{await f.close()}
 })
}
it('adds the inventory query field only after acknowledgement and validates fields',async()=>{
 const f=await setup();try{
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
  const context={key:'inventory-item-details:list',title:'库存流水',detail:'',scope:'',queryFields:[] as string[]}
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'inventory-item-details',context})
  await expect(f.chat.configureInventoryFilters('s',['password'],undefined,new AbortController().signal)).rejects.toThrow(/配置无效/)
  const pending=f.chat.configureInventoryFilters('s',['product_code'],undefined,new AbortController().signal)
  await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
  const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
  expect(n).toMatchObject({target:'filters',queryFields:['product_code']})
  expect(n).not.toHaveProperty('productCode')
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:'inventory-item-details',navigationId:n.id,context:{...context,queryFields:['product_code']}})
  expect(await pending).toContain('查询栏已更新')
 }finally{await f.close()}
})

it('hydrates multi-product selections before sending them to the page',async()=>{
 const f=await setup();try{
  const products=[{id:'a',name:'Product A',code:'A'},{id:'b',name:'Product B',code:'B'}]
  f.ctx.oryhRecords={productSearch:async()=>({rows:products,total:2,pages:1})} as never
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
  const context={key:'inventory-item-details:list',title:'库存流水',detail:'',scope:''}
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'inventory-item-details',context})
  await expect(f.chat.configureInventoryFilters('s',['product_code'],undefined,new AbortController().signal,['a','a'])).rejects.toThrow(/选择无效/)
  const pending=f.chat.configureInventoryFilters('s',['product_code'],undefined,new AbortController().signal,['a','b'])
  await new Promise(r=>setTimeout(r,0))
  await vi.waitFor(async()=>expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeDefined())
  const n=(await f.chat.homePoll({sessionId:'s',connectionId}))!
  expect(n.products).toEqual(products)
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:2,page:'inventory-item-details',navigationId:n.id,context:{...context,queryFields:['product_code'],productIds:['a','b']}})
  expect(await pending).toContain('查询栏已更新')
 }finally{await f.close()}
})

it('does not queue Chat navigation after the server revokes the required grant',async()=>{
 const f=await setup();try{
  await f.chat.select({sessionId:'s',connectionId,homeOnly:true})
  f.chat.pageSync({sessionId:'s',connectionId,viewId:'v',revision:1,page:'my-open-todos'})
  f.identity.identity.permissions=[]
  await expect(f.chat.navigate('s','inventory-items',new AbortController().signal)).rejects.toThrow('权限')
  expect(await f.chat.homePoll({sessionId:'s',connectionId})).toBeUndefined()
 }finally{await f.close()}
})
