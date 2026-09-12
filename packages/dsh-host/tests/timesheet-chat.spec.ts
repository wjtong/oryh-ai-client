import { describe,it,expect,vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionId } from '@oryh/ai-client-foundation'
import type { OryhTimesheetRemote,TimesheetFields } from '@oryh/ai-client-timesheets'
import { TimesheetChat } from '../src/timesheet-chat.js'
import { CommandQueue } from '../src/command-queue.js'
/** The page's shape: what the form syncs back and what a stored proposal must look like. */
const form:TimesheetFields={period_start:'2026-09-09',period_end:'2026-09-09',source_report_text:'开发',entries:[{work_date:'2026-09-09',hours:8,work_type:'normal',project_id:'p',task:'开发',notes:''}]}
/** The tool's shape: the page form plus the name assertion the tool must make about each id. */
const proposed={...form,entries:form.entries.map(entry=>({...entry,project_name:'项目'}))}
const projects=[{id:'p',name:'项目'},{id:'q',name:'另一个项目'}]
function setup(){
 const prepare=vi.fn(),confirm=vi.fn()
 const api={timesheetList:async()=>[{id:'h',employee_id:'e',period_start:'2026-09-09',period_end:'2026-09-09',status:'draft',source_report_text:''}],timesheetQueue:async()=>[{id:'t',entity_id:'h',title:'审批',description:''}],timesheetOptions:async()=>({workTypes:[{name:'normal',title:'正常工时'}],projects,editableStates:['draft'],submitStates:['draft'],requirements:[]}),timesheetDetail:async()=>({header:{id:'h',employee_id:'e',period_start:'2026-09-09',period_end:'2026-09-09',status:'draft',source_report_text:''},entries:[{...form.entries[0],id:'line'}],approval_records:[]}),timesheetPrepare:prepare,timesheetConfirm:confirm} as unknown as OryhTimesheetRemote
 const binding={connectionId:'c' as ConnectionId,timesheetPage:'page',manager:false}
 const queue=new CommandQueue()
 const registered=new Map<string,{execute:(args:never,extra:never)=>Promise<string>}>()
 const ctx={tools:{register:(tool:{name:string})=>{registered.set(tool.name,tool as never)}},effect:()=>{}} as unknown as Context
 const chat=new TimesheetChat(ctx,api,async()=>binding,queue)
 chat.install()
 const state={sessionId:'s',connectionId:binding.connectionId,pageKey:'page',revision:1,manager:false,fields:form}
 return {chat,api,binding,state,prepare,confirm,queue,tool:(name:string)=>registered.get(name)!}
}
/** Drive microtasks until `ready`, so a staged proposal is observed rather than guessed at. */
async function until(ready:()=>boolean){
 for(let tick=0;tick<500&&!ready();tick++)await new Promise(resolve=>{setTimeout(resolve,1)})
 if(!ready())throw new Error('the chat never reached the expected state')
}
describe('timesheet suggestions',()=>{
 it('reads user fields and stages a proposal without prepare, confirm or tokens',async()=>{
  const f=setup();await f.chat.sync(f.state);expect((await f.chat.read('s')).form).toEqual(form)
  await f.chat.propose('s',1,{kind:'create',fields:proposed});const p=f.chat.pending('s')
  // The stored proposal is page-shaped: the name assertion is for validation, never for the form.
  expect(p?.action.fields).toEqual(form)
  expect(p?.action.fields?.entries[0]).not.toHaveProperty('project_name')
  expect(JSON.stringify(p)).not.toContain('token');expect(f.prepare).not.toHaveBeenCalled();expect(f.confirm).not.toHaveBeenCalled()
 })
 it('accepts incremental form filling without treating it as a savable record',async()=>{
  const f=setup();await f.chat.sync(f.state);await f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],hours:0,work_type:'',task:'先填写工作内容'}]}})
  expect((f.chat.pending('s'))?.action.fields?.entries[0]?.hours).toBe(0);expect(f.prepare).not.toHaveBeenCalled()
 })
 it('invalidates suggestions after manual edits and rejects stale revisions and pages',async()=>{
  const f=setup();await f.chat.sync(f.state);await f.chat.propose('s',1,{kind:'create',fields:proposed});await f.chat.sync({...f.state,revision:2})
  expect(f.chat.pending('s')).toBeUndefined();await expect(f.chat.propose('s',1,{kind:'create',fields:proposed})).rejects.toThrow(/版本/)
  await expect(f.chat.sync({...f.state,pageKey:'other'})).rejects.toThrow(/页面/);f.chat.clear('s');await expect(f.chat.read('s')).rejects.toThrow(/尚未同步/)
 })
 it('rejects unknown targets, guessed projects, invalid hours and cross-menu approvals',async()=>{
  const f=setup();await f.chat.sync(f.state);await expect(f.chat.read('s','foreign')).rejects.toThrow(/不在/)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],hours:25}]}})).rejects.toThrow(/24/)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],project_id:'foreign'}]}})).rejects.toThrow(/项目/)
  await expect(f.chat.propose('s',1,{kind:'approve',headerId:'h',todoId:'t',decision:'approved',comment:'同意'})).rejects.toThrow(/菜单/)
 })
 it('rejects a project whose asserted name does not match the id it resolved to',async()=>{
  // The observed defect: a well-formed id that is not the project the user asked for. An id-only
  // check cannot see it, so the tool must state the name as a second, independent claim.
  const f=setup();await f.chat.sync(f.state)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],project_id:'q'}]}}))
   .rejects.toThrow(/不一致.*另一个项目.*项目/s)
  expect(f.chat.pending('s')).toBeUndefined()
 })
 it('requires the id and the name to be given together or both left empty',async()=>{
  const f=setup();await f.chat.sync(f.state)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],project_id:''}]}})).rejects.toThrow(/没有给出项目编号/)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],project_name:''}]}})).rejects.toThrow(/请同时给出项目名称/)
  // Both empty is the documented way to record no project at all.
  await f.chat.propose('s',1,{kind:'create',fields:{...proposed,entries:[{...proposed.entries[0],project_id:'',project_name:''}]}})
  expect(f.chat.pending('s')?.action.fields?.entries[0]?.project_id).toBe('')
 })
 it('flags duplicate project names so the model has to ask which one',async()=>{
  const f=setup();await f.chat.sync(f.state)
  f.api.timesheetOptions=async()=>({workTypes:[{name:'normal',title:'正常工时'}],projects:[{id:'p',name:'项目'},{id:'q',name:'项目'}],editableStates:['draft'],submitStates:['draft'],requirements:[]})
  const read=await f.chat.read('s')
  expect(read.ambiguousProjects).toEqual(['项目'])
  expect(read.notice).toContain('同名项目')
 })
 it('reports the page content in the receipt rather than echoing the requested fields',async()=>{
  const f=setup();await f.chat.sync(f.state)
  const call=f.tool('oryh_timesheet_propose').execute({revision:1,action:{kind:'create',fields:proposed}} as never,{agent:{id:'s'},signal:new AbortController().signal} as never)
  await until(()=>f.chat.pending('s')!==undefined)
  // The page ends up holding a different project and fewer hours than were requested.
  await f.chat.sync({...f.state,revision:2,fields:{...form,entries:[{...form.entries[0]!,project_id:'q',hours:3}]}})
  const receipt=JSON.parse(await call)
  expect(receipt.applied.entries[0].project_id).toBe('q')
  expect(receipt.applied.entries[0].project_name).toBe('另一个项目')
  expect(receipt.applied.total_hours).toBe(3)
  expect(receipt.message).toContain('其他修改')
 })
 it('names the applied project and totals when the page matches the request',async()=>{
  const f=setup();await f.chat.sync(f.state)
  const call=f.tool('oryh_timesheet_propose').execute({revision:1,action:{kind:'create',fields:proposed}} as never,{agent:{id:'s'},signal:new AbortController().signal} as never)
  await until(()=>f.chat.pending('s')!==undefined)
  await f.chat.sync({...f.state,revision:2,fields:form})
  const receipt=JSON.parse(await call)
  expect(receipt.message).toContain('已更新')
  expect(receipt.applied.entries[0].project_name).toBe('项目')
  expect(receipt.applied.total_hours).toBe(8)
  expect(receipt.applied.daily_hours).toEqual([{work_date:'2026-09-09',hours:8}])
 })
 it('restricts approval proposals to the current managers todo and never confirms',async()=>{
  const f=setup();f.binding.manager=true;await f.chat.sync({...f.state,manager:true})
  await expect(f.chat.propose('s',1,{kind:'approve',headerId:'h',todoId:'foreign',decision:'approved',comment:'同意'})).rejects.toThrow(/当前员工/)
  await f.chat.propose('s',1,{kind:'approve',headerId:'h',todoId:'t',decision:'approved',comment:'同意'});expect(f.confirm).not.toHaveBeenCalled()
 })
 it('discards in-flight reads when the user leaves the page',async()=>{
  const f=setup();await f.chat.sync(f.state);let release!:()=>void
  const list=f.api.timesheetList;f.api.timesheetList=async id=>{await new Promise<void>(r=>{release=r});return list(id)}
  const pending=f.chat.read('s');await new Promise(r=>setTimeout(r,0));f.chat.clear('s');release();await expect(pending).rejects.toThrow(/离开/)
 })
})
