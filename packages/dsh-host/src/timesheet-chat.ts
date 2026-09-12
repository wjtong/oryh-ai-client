import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { OryhClientError, type ConnectionId } from '@oryh/ai-client-foundation'
import { validateTimesheet, type OryhTimesheetRemote, type TimesheetAction, type TimesheetFields, type TimesheetLine } from '@oryh/ai-client-timesheets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TimesheetChatState, TimesheetChatProposal, TimesheetReviewState } from './types.js'
import type { CommandQueue } from './command-queue.js'
const line=z.object({id:z.string().optional(),work_date:z.string(),hours:z.number(),work_type:z.string(),project_id:z.string(),project_name:z.string(),task:z.string().max(200),notes:z.string().max(2000)}).strict()
const fields=z.object({period_start:z.string(),period_end:z.string(),source_report_text:z.string().max(10000),entries:z.array(line).min(1).max(100)}).strict()
/**
 * The page's own shape. `project_name` is the tool's assertion about its id resolution, not a form
 * field, so it must not reach the page; this schema strips it from both sides of the receipt
 * comparison, which would otherwise compare a page snapshot against a differently-shaped request.
 */
const pageFields=z.object({period_start:z.string(),period_end:z.string(),source_report_text:z.string(),entries:z.array(z.object({id:z.string().optional(),work_date:z.string(),hours:z.number(),work_type:z.string(),project_id:z.string(),task:z.string(),notes:z.string()}))})
const lineSnapshot=({project_name:_asserted,id,...entry}:z.infer<typeof line>):TimesheetLine=>({...entry,...(id?{id}:{})})
const formSnapshot=(value:z.infer<typeof fields>):TimesheetFields=>({period_start:value.period_start,period_end:value.period_end,source_report_text:value.source_report_text,entries:value.entries.map(lineSnapshot)})
/** Drop the tool's name assertions so only page-shaped data is stored or published. */
function pageAction(value:z.infer<typeof actionSchema>):TimesheetAction{
  if(value.kind==='update')return {kind:value.kind,headerId:value.headerId,fields:formSnapshot(value.fields)}
  if(value.kind==='create')return {kind:value.kind,fields:formSnapshot(value.fields)}
  if(value.kind==='add-line')return {kind:value.kind,headerId:value.headerId,line:lineSnapshot(value.line)}
  if(value.kind==='edit-line')return {kind:value.kind,headerId:value.headerId,entryId:value.entryId,line:lineSnapshot(value.line)}
  return value
}
/**
 * What the page actually holds, read from the synced form rather than echoed from the request.
 *
 * A content-free receipt let the model restate its own intent unchallenged, so a wrong project
 * read back as a confident success. Naming the project and the hours the page really has is what
 * makes that contradiction visible in the trajectory and to the user.
 * @param form - the form snapshot the page synced back.
 * @param projects - currently available projects, used to name the ids the page holds.
 * @returns the period, per-day and total hours, and each entry with its project id and name.
 */
function appliedSummary(form:TimesheetFields,projects:readonly {id:string;name:string}[]){
  const daily=new Map<string,number>()
  for(const l of form.entries)daily.set(l.work_date,(daily.get(l.work_date)??0)+l.hours)
  return {
    period_start:form.period_start,period_end:form.period_end,
    total_hours:form.entries.reduce((sum,l)=>sum+l.hours,0),
    daily_hours:[...daily].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([work_date,hours])=>({work_date,hours})),
    entries:form.entries.map(l=>({work_date:l.work_date,hours:l.hours,work_type:l.work_type,project_id:l.project_id,
      project_name:l.project_id?projects.find(p=>p.id===l.project_id)?.name??'（不在当前可用项目中）':'',task:l.task})),
  }
}
const actionSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('create'),fields}).strict(),
  z.object({kind:z.literal('update'),headerId:z.string(),fields}).strict(),
  z.object({kind:z.literal('submit'),headerId:z.string()}).strict(),
  z.object({kind:z.literal('approve'),headerId:z.string(),todoId:z.string(),decision:z.enum(['approved','rejected','returned']),comment:z.string().trim().min(1).max(2000)}).strict(),
  z.object({kind:z.literal('add-line'),headerId:z.string(),line}).strict(),
  z.object({kind:z.literal('edit-line'),headerId:z.string(),entryId:z.string(),line}).strict(),
  z.object({kind:z.literal('delete-line'),headerId:z.string(),entryId:z.string()}).strict(),
])
interface PageBinding { connectionId:ConnectionId; timesheetPage?:string; manager?:boolean }
const lineSpec={type:'object',additionalProperties:false,properties:{id:{type:'string',description:'已有明细保留原编号；新增明细不传'},work_date:{type:'string',required:true},hours:{type:'number',required:true},work_type:{type:'string',required:true},project_id:{type:'string',required:true,description:'不关联项目时必须为空字符串'},project_name:{type:'string',required:true,description:'project_id 对应项目的名称，逐字取自 read 返回的 projects；与编号不一致会被拒绝。不关联项目时必须为空字符串'},task:{type:'string',required:true},notes:{type:'string',required:true}}} as const
const fieldsSpec={type:'object',additionalProperties:false,properties:{period_start:{type:'string',required:true},period_end:{type:'string',required:true},source_report_text:{type:'string',required:true},entries:{type:'array',required:true,items:lineSpec}}} as const
const actionSpec={type:'object',required:true,additionalProperties:false,properties:{kind:{type:'string',required:true,enum:['create','update','submit','approve','add-line','edit-line','delete-line']},fields:fieldsSpec,headerId:{type:'string'},todoId:{type:'string'},entryId:{type:'string'},line:lineSpec,decision:{type:'string',enum:['approved','rejected','returned']},comment:{type:'string'}}} as const
const fail=(text:string)=>new OryhClientError(text,'request-failed')
/** How long a review may run before the page stops waiting on it. */
const REVIEW_TIMEOUT_MS=120_000
/** Ephemeral suggestions only. No prepare/confirm method or confirmation token reaches a tool. */
export class TimesheetChat {
  private states=new Map<string,TimesheetChatState>()
  private proposals=new Map<string,TimesheetChatProposal>()
  private reviews=new Map<string,TimesheetReviewState>()
  /** Identity of each pending request, kept Host-side: while it is still in the agent's inbox the
   * review is queued behind a conversation turn; once gone, the review turn itself is running. */
  private reviewMessages=new Map<string,string>()
  constructor(private ctx:Context,private api:OryhTimesheetRemote|undefined,private binding:(id:string,verify?:boolean,write?:boolean)=>Promise<PageBinding>,private queue:CommandQueue){}
  current(id:string){return this.states.get(id)}
  /** The staged suggestion the command stream publishes for this session. */
  pending(id:string){return this.proposals.get(id)}
  clear(id:string){this.states.delete(id);this.proposals.delete(id);this.reviews.delete(id);this.reviewMessages.delete(id);this.reviewSettled(id);this.queue.changed(id)}
  /** The review the command stream publishes for this session. */
  review(id:string){return this.reviews.get(id)}
  /** Why the last review turn died, kept until the status listener can report it. */
  private reviewFailures=new Map<string,string>()
  /** Timers that settle a review no turn ever finishes; cleared the moment it settles. */
  private reviewTimers=new Map<string,ReturnType<typeof setTimeout>>()
  /** Whether a review is still waiting on the agent, and so may still be settled. */
  private reviewLive(id:string){const s=this.reviews.get(id)?.status;return s==='queued'||s==='reviewing'}
  /**
   * Settle a review the agent never reported on.
   *
   * `unavailable` is a terminal state, not a pause: the page offers a retry and keeps 确认执行
   * disabled. Reporting the underlying failure verbatim matters more than tidy wording — a quota
   * error or a dead model is something only the user can act on, and "核对失败" tells them nothing.
   * @param id - session whose review failed.
   * @param message - the reason, shown to the user as-is.
   */
  private reviewFailed(id:string,message:string){
    const current=this.reviews.get(id)
    if(!current||!this.reviewLive(id))return
    this.reviewSettled(id)
    this.reviews.set(id,{...current,status:'unavailable',message})
    this.queue.changed(id)
  }
  /** Drop the bookkeeping a settled review no longer needs. */
  private reviewSettled(id:string){
    const timer=this.reviewTimers.get(id)
    if(timer!==undefined){clearTimeout(timer);this.reviewTimers.delete(id)}
    this.reviewFailures.delete(id)
  }
  /**
   * Ask the session's agent to check this timesheet against the enterprise norms before submitting.
   *
   * The norms live on the server — in the workflow definitions the agent reads, and in the ORYH
   * Skills installed for this person (docs/23) — not in code, so the only way to apply them is to
   * let the agent read them. `followup` is the right door: it queues the request as its own turn AND wakes an idle
   * driver. A bare `inbox.append` only queues — with the agent idle, which is the common case when
   * someone clicks submit, the message sits in the chat forever and no turn ever runs. Nothing here
   * blocks; progress reaches the page over the command stream. See docs/22.
   * @param id - session whose agent performs the review.
   * @param headerId - timesheet being submitted; a verdict for any other document is ignored.
   */
  async reviewStart(id:string,headerId:string):Promise<void>{
    await this.binding(id,true,true)
    const agent=this.ctx.agents.get(id as never)
    if(!agent)throw fail('当前会话不可用，无法进行规范核对。')
    const request=createUserMessage({content:[{type:'text',
      text:`（提交动作触发）请按企业当前工时流程要求核对这张待提交的工时单（编号 ${headerId}）。先用 oryh_timesheet_read 读取实际内容，再调用 oryh_timesheet_review_result 回报结论；不要修改表单。`}],source:{kind:'user'}})
    agent.followup(request)
    this.reviewMessages.set(id,String(request.id))
    this.reviewSettled(id)
    // Backstop for an agent that neither reports nor goes idle. The status listener catches the
    // common failure within a second; this only covers a driver that hangs, and is generous because
    // a review queued behind a long conversation turn is legitimately slow.
    this.reviewTimers.set(id,setTimeout(()=>this.reviewFailed(id,'核对超时，未收到结论。'),REVIEW_TIMEOUT_MS))
    this.reviews.set(id,{headerId,status:this.reviewPhase(id,agent)})
    this.queue.changed(id)
  }
  /**
   * Refuse a submit the norm review has not cleared.
   *
   * Only `passed` opens the door — a flagged verdict, a review still running, and a review that
   * could not run at all all block. That is deliberate: any state the user can reach by waiting or
   * by closing the session would otherwise be a way around the verdict, and then the check is
   * decoration. The submitter still has ORYH Console and any other agent; what this removes is
   * *this* client being the easy way past its own review.
   * @param action - the intent being confirmed; anything but a submit passes straight through.
   * @param sessionId - chat session whose agent ran the review.
   */
  assertReviewPassed(action:{kind:string;headerId?:string},sessionId?:string):void{
    if(action.kind!=='submit')return
    const review=sessionId===undefined?undefined:this.reviews.get(sessionId)
    if(review?.status==='passed'&&review.headerId===action.headerId)return
    if(review?.status==='flagged')throw new OryhClientError(`未通过企业工时流程要求核对：${review.message||'存在冲突'}。请修改后重新提交。`,'request-failed')
    if(review?.status==='queued'||review?.status==='reviewing')throw new OryhClientError('规范核对尚未完成，请等待结论。','request-failed')
    throw new OryhClientError('本次提交未经企业工时流程要求核对，无法提交。请在 Chat 中保持会话后重新提交。','request-failed')
  }
  /** Drop the review, whether the user skipped it or the submission finished. */
  reviewClear(id:string){this.reviewMessages.delete(id);this.reviewSettled(id);if(this.reviews.delete(id))this.queue.changed(id)}
  /** Queued while the request is still pending in the inbox; reviewing once the agent claimed it. */
  private reviewPhase(id:string,agent:{inbox:{nextTurn:readonly {id:string}[]}}):'queued'|'reviewing'{
    const message=this.reviewMessages.get(id)
    return message!==undefined&&agent.inbox.nextTurn.some(m=>String(m.id)===message)?'queued':'reviewing'
  }
  /**
   * Mark the review as actually running.
   *
   * `agent/status` alone is not enough: the idle -> running transition fires before the driver
   * drains the inbox, so the request still looks queued at that moment and no later transition
   * arrives before the verdict. The review's own first step is the dependable signal, since the
   * request tells the agent to read the timesheet before reporting. The cost is a narrow false
   * positive — a conversation turn that happens to read a timesheet while our request is still
   * queued flips the label early — which changes wording only, never the gate.
   */
  reviewClaimed(id:string){
    const current=this.reviews.get(id)
    if(current?.status!=='queued')return
    this.reviews.set(id,{...current,status:'reviewing'})
    this.queue.changed(id)
  }
  async sync(state:TimesheetChatState):Promise<void>{
    const b=await this.binding(state.sessionId,false)
    if(b.connectionId!==state.connectionId||b.timesheetPage!==state.pageKey||Boolean(b.manager)!==state.manager)throw fail('工时页面已改变，请重新关联。')
    const old=this.states.get(state.sessionId)
    if(old&&old.pageKey===state.pageKey&&old.revision>state.revision)return
    if(!old||old.revision!==state.revision)this.proposals.delete(state.sessionId)
    this.states.set(state.sessionId,structuredClone(state))
    this.queue.settle(state.sessionId)
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
    // Duplicate names cannot be resolved from a name alone, and the id/name pairing cannot catch a
    // wrong pick between two projects that share one. Naming them forces the ambiguity to the user.
    const counts=new Map<string,number>()
    for(const p of options.projects)counts.set(p.name,(counts.get(p.name)??0)+1)
    const ambiguousProjects=[...counts].filter(([,count])=>count>1).map(([name])=>name)
    return {revision:s.revision,manager:s.manager,today:new Date().toLocaleDateString('en-CA'),options,ambiguousProjects,records,detail,form:s.fields,localEdits:s.localEdits,pendingSuggestion:this.proposals.get(id)?.action,notice:'表单是未保存的用户输入。建议需在中间栏应用或核对确认，不代表已保存。'+(ambiguousProjects.length?`注意：名称“${ambiguousProjects.join('”“')}”各自对应多个不同项目；只有当用户要的正是其中之一时才必须先反问是哪一个，其余项目名称唯一，不必反问。`:'')}
  }
  async propose(id:string,revision:number,input:unknown):Promise<{message:string;proposalId:string;projects:{id:string;name:string}[]}>{
    await this.binding(id,true,true)
    const {state:s,api}=await this.page(id)
    if(s.revision!==revision)throw fail('表单版本已改变，请重新读取。')
    const parsed=actionSchema.safeParse(input)
    if(!parsed.success)throw fail('工时建议格式无效：'+parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '))
    const action:TimesheetAction=pageAction(parsed.data)
    if(s.manager!==(action.kind==='approve'))throw fail('请在我的工时中填写或修改，在工时审批菜单中建议审批。')
    const data=await this.read(id,action.headerId)
    if(action.kind==='create'||action.kind==='update'){
      const daily=new Map<string,number>()
      for(const l of action.fields!.entries){
        if(l.hours<0||l.hours>24)throw fail('每天工时不能超过 24 小时，也不能为负数。')
        daily.set(l.work_date,(daily.get(l.work_date)??0)+l.hours)
      }
      if([...daily.values()].some(h=>h>24))throw fail('每天合计不能超过 24 小时。')
    }
    if(['update','add-line','edit-line','delete-line'].includes(action.kind) && (!data.detail?.canEdit || s.headerId!==action.headerId))throw fail('请先打开允许编辑的本人工时。')
    if(action.kind==='update'){
      const ids=action.fields!.entries.flatMap(l=>l.id?[l.id]:[])
      if(new Set(ids).size!==ids.length||ids.some(id=>!data.detail!.entries.some(l=>l.id===id)))throw fail('已有明细编号必须保留且不能重复；新明细不传编号。')
    }
    if(action.line){const d=data.detail!;const entries=action.kind==='edit-line'?d.entries.map(e=>e.id===action.entryId?action.line!:e):[...d.entries,action.line];validateTimesheet({...d.header,entries})}
    if(action.kind==='edit-line'||action.kind==='delete-line')if(!data.detail?.entries.some(e=>e.id===action.entryId))throw fail('明细不属于这张工时单。')
    if(action.kind==='approve'&&!data.records.some(r=>'entity_id'in r&&r.id===action.todoId&&r.entity_id===action.headerId))throw fail('审批必须关联当前员工的待办。')
    if(['update','add-line','edit-line','delete-line'].includes(action.kind)&&!data.options.editableStates.includes(data.detail!.header.status))throw fail('当前单据不允许修改明细。')
    if(action.kind==='submit'&&!data.options.submitStates.includes(data.detail!.header.status))throw fail('当前单据状态不允许提交。')
    const asserted=(parsed.data.kind==='create'||parsed.data.kind==='update')?parsed.data.fields.entries:('line' in parsed.data?[parsed.data.line]:[])
    for(const l of asserted){
      if((l.work_type||!['create','update'].includes(action.kind))&&!data.options.workTypes.some(o=>o.name===l.work_type))throw fail('请选择企业已配置的工时类型。')
      const named=l.project_name.trim()
      if(!l.project_id){
        if(named)throw fail(`明细声明了项目“${named}”却没有给出项目编号。要关联项目必须同时给出编号与名称；不关联项目时两者都留空。`)
        continue
      }
      const project=data.options.projects.find(o=>o.id===l.project_id)
      if(!project)throw fail('请选择当前可用项目，不要猜测编号。')
      // The name is a second, independent statement of the same choice. An id-only check cannot
      // tell a correctly-formed id from the one the user actually asked for; a mismatch here is
      // the resolution error itself, surfaced before it reaches the form.
      if(!named)throw fail(`请同时给出项目名称以核对编号：编号 ${l.project_id} 对应“${project.name}”。`)
      if(named!==project.name)throw fail(`项目编号与名称不一致：编号 ${l.project_id} 实际是“${project.name}”，建议里写的是“${named}”。请重新确认用户要求的是哪个项目，必要时先反问，不要自行选择。`)
    }
    this.check(id,s)
    const proposal={id:randomUUID(),revision,action}
    this.proposals.set(id,proposal)
    this.queue.changed(id)
    return {message:'填写更新已发送到右侧未保存表单；其他操作等待用户核对。尚未保存、提交或审批。',proposalId:proposal.id,projects:data.options.projects}
  }
  install(){
    const output={schema:{type:'string' as const},render:(_a:unknown,value:string)=>[{type:'text' as const,text:value}]}
    this.ctx.tools.register(defineTool({name:'oryh_timesheet_read',description:'读取当前工时菜单的表单版本、未保存表单、本人工时或经理审批队列、企业工时类型和项目。headerId 为空读取当前页面；非空只可查询返回列表中的工时。',parameters:{headerId:{type:'string',description:'工时编号；没有指定则传空字符串'}},output,execute:async(args,e)=>{if(!e.agent)throw fail('需要会话');e.signal.throwIfAborted();this.reviewClaimed(String(e.agent.id));const result=await this.read(String(e.agent.id),args.headerId);e.signal.throwIfAborted();return JSON.stringify(result)}}))
    this.ctx.tools.register(defineTool({name:'oryh_timesheet_propose',description:'生成工时建议，不写服务端。先 read 获取 revision，传 action 对象。新建表单：kind=create；编辑已打开的工时：kind=update,headerId，fields 中已有行保留 id，新增行不传 id，删除行从 entries 移除。优先更新整张表单，所有修改在页面统一保存。fields 为完整快照，保留未要求修改的内容。允许分步填写：未知字段保留空字符串，未填写小时保留 0，不必等所有内容齐全；正式保存会校验完整性。提交：kind=submit,headerId。添加明细：kind=add-line,headerId,line。编辑：kind=edit-line,headerId,entryId,line。删除明细：kind=delete-line,headerId,entryId。审批：kind=approve,headerId,todoId,decision,comment。只传该操作需要的字段。关联项目必须同时给出 project_id 与 project_name，名称逐字取自 read 的 projects；两者不一致会被拒绝，这是为了拦住编号解析错误。不关联项目时 project_id 与 project_name 都传空字符串。read 的 ambiguousProjects 列出同名项目，遇到时必须先反问用户是哪一个，不要自行挑选。日期为 YYYY-MM-DD，工时类型必须使用 read 返回的 name。create 和 update 自动更新业务栏的未保存表单，无需点击应用；保存、提交和审批仍需核对。成功回执里的 applied 是页面实际生效的内容（项目编号与名称、每日工时、合计），向用户复述必须依据它，不能复述本次调用的参数。不能声称已保存或执行。',parameters:{revision:{type:'integer',required:true},action:actionSpec},output,execute:async(args,e)=>{if(!e.agent)throw fail('需要会话');e.signal.throwIfAborted();const id=String(e.agent.id);const result=await this.propose(id,args.revision,args.action);if(args.action.kind==='create'||args.action.kind==='update'){try{
      const applied=await this.queue.wait<{message:string;applied:ReturnType<typeof appliedSummary>|undefined}>(id,'timesheet-form',{
        invalid:()=>this.states.get(id)?undefined:'页面已离开，填写已取消',
        until:()=>{const state=this.states.get(id);if(!state||state.revision===args.revision)return undefined
          // A synced page need not carry a form at all, so there may be nothing to summarize.
          const form=state.fields
          const matched=form!==undefined&&JSON.stringify(pageFields.safeParse(form).data)===JSON.stringify(pageFields.safeParse(args.action.fields).data)
          // The summary comes from the page's own snapshot either way, so a mismatch reports what
          // the form actually holds instead of what was requested.
          return {message:matched?'右侧工时表单已更新，尚未保存。以下 applied 是页面实际内容，请按它向用户复述，不要复述本次参数。':'表单发生其他修改，请重新读取，不能声称填写成功。以下 applied 是页面实际内容。',
            applied:form===undefined?undefined:appliedSummary(form,result.projects)}},
        expired:'表单未确认填写，请重新读取。',timeoutMs:6000,signal:e.signal,
      })
      return JSON.stringify(applied)
    }catch(error){if(this.proposals.get(id)?.id===result.proposalId)this.proposals.delete(id);throw error}}return JSON.stringify(result)}}))
    this.ctx.tools.register(defineTool({name:'oryh_timesheet_review_result',description:'回报一次提交前的工时规范核对结论。只在收到"（提交动作触发）"的核对请求后调用，且必须先用 oryh_timesheet_read 读过实际内容。verdict=passed 表示未发现与企业工时流程要求冲突；verdict=flagged 表示存在冲突，message 用一两句话说明是哪一条、具体差多少，供用户判断。这不是保存或提交，用户仍需在页面确认。',
      parameters:{verdict:{type:'string',required:true,enum:['passed','flagged']},message:{type:'string',required:true,description:'flagged 时说明冲突；passed 时可留空字符串'}},output,
      execute:async(args,e)=>{if(!e.agent)throw fail('需要会话');const id=String(e.agent.id)
        const current=this.reviews.get(id)
        if(!current)return '当前没有待回报的核对请求，结论已忽略。'
        // The page moved on while the agent was thinking; a verdict about the old document is noise.
        if(!this.reviewLive(id))return '该核对请求已结束，结论已忽略。'
        this.reviewSettled(id)
        this.reviews.set(id,{...current,status:args.verdict==='passed'?'passed':'flagged',message:String(args.message??'')})
        this.queue.changed(id)
        return '核对结论已回报给页面，等待用户确认。'}}))
    // A turn that dies takes the verdict with it. The failure itself is the only place the reason
    // exists (a model quota error, say), and the page is blocked until something settles the review,
    // so keep it for the status listener below to report.
    this.ctx.on('agent/error',({agent,error}:{agent:{id:unknown};error:unknown})=>{
      const id=String(agent.id)
      if(this.reviewLive(id))this.reviewFailures.set(id,error instanceof Error?error.message:String(error))
    })
    // The queued -> reviewing transition rides the agent's own status events rather than a poll:
    // every transition re-reads the inbox, which is what actually says whether our request is still
    // waiting behind a conversation turn.
    this.ctx.on('agent/status',({agent,status}:{agent:{id:unknown;inbox:{nextTurn:readonly {id:string}[]}};status?:string})=>{
      const id=String(agent.id),current=this.reviews.get(id)
      if(!current||!this.reviewLive(id))return
      // Going idle after the review turn started means it ran and ended without reporting. Before
      // submitting was gated on the verdict this only cost a stale label; now it is what stands
      // between the user and a submit, so it has to settle rather than spin forever. The claim is
      // read from our own state, not recomputed from the inbox: the request id can linger there
      // after the driver has taken it, and this must not mistake a dead turn for a queued one.
      if(status==='idle'&&current.status==='reviewing'){this.reviewFailed(id,this.reviewFailures.get(id)??'核对回合已结束但没有回报结论。');return}
      const phase=this.reviewPhase(id,agent)
      // Only ever forward: once the review turn has been claimed it is running, whatever the inbox
      // still says.
      if(phase===current.status||current.status==='reviewing')return
      this.reviews.set(id,{...current,status:phase})
      this.queue.changed(id)
    })
    this.ctx.effect(()=>()=>{this.states.clear();this.proposals.clear();this.reviews.clear();this.reviewMessages.clear()},'oryh timesheet suggestions')
  }
}
