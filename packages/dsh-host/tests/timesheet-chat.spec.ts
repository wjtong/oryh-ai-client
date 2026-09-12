import { describe,it,expect,vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionId,OryhTimesheetRemote,TimesheetFields } from '@oryh/ai-client-core/types'
import { TimesheetChat } from '../src/timesheet-chat.js'
import { CommandQueue } from '../src/command-queue.js'
const fields:TimesheetFields={period_start:'2026-09-09',period_end:'2026-09-09',source_report_text:'开发',entries:[{work_date:'2026-09-09',hours:8,work_type:'normal',project_id:'p',task:'开发',notes:''}]}
function setup(){
 const prepare=vi.fn(),confirm=vi.fn()
 const api={timesheetList:async()=>[{id:'h',employee_id:'e',period_start:'2026-09-09',period_end:'2026-09-09',status:'draft',source_report_text:''}],timesheetQueue:async()=>[{id:'t',entity_id:'h',title:'审批',description:''}],timesheetOptions:async()=>({workTypes:[{name:'normal',title:'正常工时'}],projects:[{id:'p',name:'项目'}],editableStates:['draft'],submitStates:['draft'],requirements:[]}),timesheetDetail:async()=>({header:{id:'h',employee_id:'e',period_start:'2026-09-09',period_end:'2026-09-09',status:'draft',source_report_text:''},entries:[{...fields.entries[0],id:'line'}],approval_records:[]}),timesheetPrepare:prepare,timesheetConfirm:confirm} as unknown as OryhTimesheetRemote
 const binding={connectionId:'c' as ConnectionId,timesheetPage:'page',manager:false}
 const chat=new TimesheetChat({} as Context,api,async()=>binding,new CommandQueue())
 const state={sessionId:'s',connectionId:binding.connectionId,pageKey:'page',revision:1,manager:false,fields}
 return {chat,api,binding,state,prepare,confirm}
}
describe('timesheet suggestions',()=>{
 it('reads user fields and stages a proposal without prepare, confirm or tokens',async()=>{
  const f=setup();await f.chat.sync(f.state);expect((await f.chat.read('s')).form).toEqual(fields)
  await f.chat.propose('s',1,{kind:'create',fields});const p=f.chat.pending('s')
  expect(p?.action.fields).toEqual(fields);expect(JSON.stringify(p)).not.toContain('token');expect(f.prepare).not.toHaveBeenCalled();expect(f.confirm).not.toHaveBeenCalled()
 })
 it('accepts incremental form filling without treating it as a savable record',async()=>{
  const f=setup();await f.chat.sync(f.state);await f.chat.propose('s',1,{kind:'create',fields:{...fields,entries:[{...fields.entries[0],hours:0,work_type:'',task:'先填写工作内容'}]}})
  expect((f.chat.pending('s'))?.action.fields?.entries[0]?.hours).toBe(0);expect(f.prepare).not.toHaveBeenCalled()
 })
 it('invalidates suggestions after manual edits and rejects stale revisions and pages',async()=>{
  const f=setup();await f.chat.sync(f.state);await f.chat.propose('s',1,{kind:'create',fields});await f.chat.sync({...f.state,revision:2})
  expect(f.chat.pending('s')).toBeUndefined();await expect(f.chat.propose('s',1,{kind:'create',fields})).rejects.toThrow(/版本/)
  await expect(f.chat.sync({...f.state,pageKey:'other'})).rejects.toThrow(/页面/);f.chat.clear('s');await expect(f.chat.read('s')).rejects.toThrow(/尚未同步/)
 })
 it('rejects unknown targets, guessed projects, invalid hours and cross-menu approvals',async()=>{
  const f=setup();await f.chat.sync(f.state);await expect(f.chat.read('s','foreign')).rejects.toThrow(/不在/)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...fields,entries:[{...fields.entries[0],hours:25}]}})).rejects.toThrow(/24/)
  await expect(f.chat.propose('s',1,{kind:'create',fields:{...fields,entries:[{...fields.entries[0],project_id:'foreign'}]}})).rejects.toThrow(/项目/)
  await expect(f.chat.propose('s',1,{kind:'approve',headerId:'h',todoId:'t',decision:'approved',comment:'同意'})).rejects.toThrow(/菜单/)
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
