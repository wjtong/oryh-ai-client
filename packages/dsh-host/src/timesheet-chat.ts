import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { OryhClientError, validateTimesheet } from '@oryh/ai-client-core'
import type { ConnectionId, OryhTimesheetRemote, TimesheetAction } from '@oryh/ai-client-core/types'
import type { TimesheetChatState, TimesheetChatPoll, TimesheetChatProposal } from './types.js'
const line=z.object({work_date:z.string(),hours:z.number(),work_type:z.string(),project_id:z.string(),task:z.string().max(200),notes:z.string().max(2000)}).strict()
const fields=z.object({period_start:z.string(),period_end:z.string(),source_report_text:z.string().max(10000),entries:z.array(line).min(1).max(100)}).strict()
const actionSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('create'),fields}).strict(),
  z.object({kind:z.literal('submit'),headerId:z.string()}).strict(),
  z.object({kind:z.literal('approve'),headerId:z.string(),todoId:z.string(),decision:z.enum(['approved','rejected','returned']),comment:z.string().trim().min(1).max(2000)}).strict(),
  z.object({kind:z.literal('add-line'),headerId:z.string(),line}).strict(),
  z.object({kind:z.literal('edit-line'),headerId:z.string(),entryId:z.string(),line}).strict(),
  z.object({kind:z.literal('delete-line'),headerId:z.string(),entryId:z.string()}).strict(),
])
interface PageBinding { connectionId:ConnectionId; timesheetPage?:string; manager?:boolean }
const lineSpec={type:'object',additionalProperties:false,properties:{work_date:{type:'string',required:true},hours:{type:'number',required:true},work_type:{type:'string',required:true},project_id:{type:'string',required:true,description:'不关联项目时必须为空字符串'},task:{type:'string',required:true},notes:{type:'string',required:true}}} as const
const fieldsSpec={type:'object',additionalProperties:false,properties:{period_start:{type:'string',required:true},period_end:{type:'string',required:true},source_report_text:{type:'string',required:true},entries:{type:'array',required:true,items:lineSpec}}} as const
const actionSpec={type:'object',required:true,additionalProperties:false,properties:{kind:{type:'string',required:true,enum:['create','submit','approve','add-line','edit-line','delete-line']},fields:fieldsSpec,headerId:{type:'string'},todoId:{type:'string'},entryId:{type:'string'},line:lineSpec,decision:{type:'string',enum:['approved','rejected','returned']},comment:{type:'string'}}} as const
const fail=(text:string)=>new OryhClientError(text,'request-failed')
/** Ephemeral suggestions only. No prepare/confirm method or confirmation token reaches a tool. */
export class TimesheetChat {
  private states=new Map<string,TimesheetChatState>()
  private proposals=new Map<string,TimesheetChatProposal>()
  constructor(private ctx:Context,private api:OryhTimesheetRemote|undefined,private binding:(id:string,verify?:boolean,write?:boolean)=>Promise<PageBinding>){}
  current(id:string){return this.states.get(id)}
  clear(id:string){this.states.delete(id);this.proposals.delete(id)}
  async sync(state:TimesheetChatState):Promise<void>{
    const b=await this.binding(state.sessionId,false)
    if(b.connectionId!==state.connectionId||b.timesheetPage!==state.pageKey||Boolean(b.manager)!==state.manager)throw fail('工时页面已改变，请重新关联。')
    const old=this.states.get(state.sessionId)
    if(old&&old.pageKey===state.pageKey&&old.revision>state.revision)return
    if(!old||old.revision!==state.revision)this.proposals.delete(state.sessionId)
    this.states.set(state.sessionId,structuredClone(state))
  }
  async poll(r:TimesheetChatPoll):Promise<TimesheetChatProposal|undefined>{
    const b=await this.binding(r.sessionId,false),s=this.states.get(r.sessionId)
    if(b.connectionId!==r.connectionId||b.timesheetPage!==r.pageKey||s?.pageKey!==r.pageKey)throw fail('会话已切换到其他业务页面，请重新同步。')
    return this.proposals.get(r.sessionId)
  }
  private async page(id:string){
    const b=await this.binding(id),state=this.states.get(id)
    if(!state||b.timesheetPage!==state.pageKey||b.connectionId!==state.connectionId||!this.api)throw fail('工时表单尚未同步，请等待 Chat 已关联后重试。')
    return {state,api:this.api}
  }
  private check(id:string,s:TimesheetChatState){if(this.states.get(id)!==s)throw fail('用户已修改表单或离开页面，请重新读取后再建议。')}
  async read(id:string,headerId=''){
    const {state:s,api}=await this.page(id)
    const [options,records]=await Promise.all([api.timesheetOptions(s.connectionId),s.manager?api.timesheetQueue(s.connectionId):api.timesheetList(s.connectionId)])
    const target=headerId||s.headerId
    const todo=s.manager?records.find(r=>'entity_id'in r&&r.entity_id===target):undefined
    if(target&&!records.some(r=>('entity_id'in r?r.entity_id:r.id)===target))throw fail('该工时不在当前员工的工时或审批队列中。')
    const detail=target?await api.timesheetDetail(s.connectionId,target,todo?.id):undefined
    this.check(id,s)
    return {revision:s.revision,manager:s.manager,today:new Date().toLocaleDateString('en-CA'),options,records,detail,form:s.fields,localEdits:s.localEdits,pendingSuggestion:this.proposals.get(id)?.action,notice:'表单是未保存的用户输入。建议需在中间栏应用或核对确认，不代表已保存。'}
  }
  async propose(id:string,revision:number,input:unknown):Promise<{message:string;proposalId:string}>{
    await this.binding(id,true,true)
    const {state:s,api}=await this.page(id)
    if(s.revision!==revision)throw fail('表单版本已改变，请重新读取。')
    const parsed=actionSchema.safeParse(input)
    if(!parsed.success)throw fail('工时建议格式无效：'+parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '))
    const action:TimesheetAction=parsed.data
    if(s.manager!==(action.kind==='approve'))throw fail('请在我的工时中填写或修改，在工时审批菜单中建议审批。')
    const data=await this.read(id,action.headerId)
    if(action.kind==='create'){
      const daily=new Map<string,number>()
      for(const l of action.fields!.entries){
        if(l.hours<0||l.hours>24)throw fail('每天工时不能超过 24 小时，也不能为负数。')
        daily.set(l.work_date,(daily.get(l.work_date)??0)+l.hours)
      }
      if([...daily.values()].some(h=>h>24))throw fail('每天合计不能超过 24 小时。')
    }
    if(action.line){const d=data.detail!;const entries=action.kind==='edit-line'?d.entries.map(e=>e.id===action.entryId?action.line!:e):[...d.entries,action.line];validateTimesheet({...d.header,entries})}
    if(action.kind==='edit-line'||action.kind==='delete-line')if(!data.detail?.entries.some(e=>e.id===action.entryId))throw fail('明细不属于这张工时单。')
    if(action.kind==='approve'&&!data.records.some(r=>'entity_id'in r&&r.id===action.todoId&&r.entity_id===action.headerId))throw fail('审批必须关联当前员工的待办。')
    if(['add-line','edit-line','delete-line'].includes(action.kind)&&!data.options.editableStates.includes(data.detail!.header.status))throw fail('当前单据不允许修改明细。')
    if(action.kind==='submit'&&!data.options.submitStates.includes(data.detail!.header.status))throw fail('当前单据状态不允许提交。')
    for(const l of action.fields?.entries??(action.line?[action.line]:[])){
      if((l.work_type||action.kind!=='create')&&!data.options.workTypes.some(o=>o.name===l.work_type))throw fail('请选择企业已配置的工时类型。')
      if(l.project_id&&!data.options.projects.some(o=>o.id===l.project_id))throw fail('请选择当前可用项目，不要猜测编号。')
    }
    this.check(id,s)
    const proposal={id:randomUUID(),revision,action}
    this.proposals.set(id,proposal)
    return {message:'填写更新已发送到右侧未保存表单；其他操作等待用户核对。尚未保存、提交或审批。',proposalId:proposal.id}
  }
  install(){
    const output={schema:{type:'string' as const},render:(_a:unknown,value:string)=>[{type:'text' as const,text:value}]}
    this.ctx.tools.register(defineTool({name:'oryh_timesheet_read',description:'读取当前工时菜单的表单版本、未保存表单、本人工时或经理审批队列、企业工时类型和项目。headerId 为空读取当前页面；非空只可查询返回列表中的工时。',parameters:{headerId:{type:'string',description:'工时编号；没有指定则传空字符串'}},output,execute:async(args,e)=>{if(!e.agent)throw fail('需要会话');e.signal.throwIfAborted();const result=await this.read(String(e.agent.id),args.headerId);e.signal.throwIfAborted();return JSON.stringify(result)}}))
    this.ctx.tools.register(defineTool({name:'oryh_timesheet_propose',description:'生成工时建议，不写服务端。先 read 获取 revision，传 action 对象。填写未保存表单：kind=create，fields 为完整快照，保留未要求修改的内容。允许分步填写：未知字段保留空字符串，未填写小时保留 0，不必等所有内容齐全；正式保存会校验完整性。提交：kind=submit,headerId。添加明细：kind=add-line,headerId,line。编辑：kind=edit-line,headerId,entryId,line。删除明细：kind=delete-line,headerId,entryId。审批：kind=approve,headerId,todoId,decision,comment。只传该操作需要的字段。不关联项目时 project_id 传空字符串，日期为 YYYY-MM-DD，工时类型必须使用 read 返回的 name。create 自动更新右侧未保存表单，无需点击应用；其他操作仍需核对。不能声称已保存或执行。',parameters:{revision:{type:'integer',required:true},action:actionSpec},output,execute:async(args,e)=>{if(!e.agent)throw fail('需要会话');e.signal.throwIfAborted();const id=String(e.agent.id);const result=await this.propose(id,args.revision,args.action);if(args.action.kind==='create'){try{for(let n=0;n<60;n++){e.signal.throwIfAborted();const state=this.states.get(id);if(!state)throw fail('页面已离开，填写已取消');if(state.revision!==args.revision)return JSON.stringify({message:JSON.stringify(fields.safeParse(state.fields).data)===JSON.stringify(fields.safeParse(args.action.fields).data)?'右侧工时表单已更新，尚未保存。':'表单发生其他修改，请重新读取，不能声称填写成功。'});await new Promise(r=>setTimeout(r,100))}}catch(error){if(this.proposals.get(id)?.id===result.proposalId)this.proposals.delete(id);throw error}}return JSON.stringify(result)}}))
    this.ctx.effect(()=>()=>{this.states.clear();this.proposals.clear()},'oryh timesheet suggestions')
  }
}
