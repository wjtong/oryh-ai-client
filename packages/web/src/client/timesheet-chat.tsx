import { useContext, useEffect, useRef, useState } from 'react'
import { Button } from '@fluentui/react-components'
import type { ConnectionId } from '@oryh/ai-client-foundation'
import type { TimesheetAction, TimesheetFields } from '@oryh/ai-client-timesheets'
import type { TimesheetChatProposal } from '@oryh/dsh-host/types'
import { BusinessSessionContext } from './todo-chat.js'
import { useCommands } from './command-stream.js'
import { useOryhRemote } from './remote.js'
const titles={create:'填写工时表单',submit:'提交工时审批',approve:'记录审批意见','add-line':'添加工时明细','edit-line':'修改工时明细','delete-line':'删除工时明细'}
export function TimesheetChat({connectionId,manager,fields,headerId,todoId,navigationId,navigationReady=true,localEdits,busy,dirty,onApply}:{connectionId:ConnectionId;manager:boolean;fields?:TimesheetFields;headerId?:string;todoId?:string;navigationId?:string;navigationReady?:boolean;localEdits:string;busy:boolean;dirty:boolean;onApply:(action:TimesheetAction)=>void}){
  const api=useOryhRemote(),sessionId=useContext(BusinessSessionContext)
  const [pageKey]=useState(()=>crypto.randomUUID()),[ready,setReady]=useState(false),[message,setMessage]=useState(''),[retry,setRetry]=useState(0),[proposal,setProposal]=useState<TimesheetChatProposal>()
  const apply=useRef(onApply),isBusy=useRef(busy);apply.current=onApply;isBusy.current=busy
  const version=useRef({json:'',revision:0}),seen=useRef('')
  const json=JSON.stringify({fields,headerId,todoId,localEdits,navigationId,navigationReady})
  if(version.current.json!==json)version.current={json,revision:version.current.revision+1}
  const revision=version.current.revision
  useEffect(()=>{
    let live=true;setReady(false);setProposal(undefined)
    if(!sessionId){setMessage('请在 Chat 中选择或新建会话，即可通过 Chat 填写工时。');return}
    setMessage('正在关联工时页面…')
    void api.chatSelect({sessionId,connectionId,timesheetPage:pageKey,manager,...(navigationId?{navigationId}:{})}).then(()=>{if(live)setReady(true)}).catch(e=>{if(live)setMessage(e instanceof Error?e.message:'Chat 关联失败')})
    return()=>{live=false;void api.chatClear(sessionId).catch(()=>{})}
  },[api,sessionId,connectionId,pageKey,manager,retry,navigationId])
  useEffect(()=>{
    if(!ready||!sessionId)return
    let live=true
    setProposal(undefined)
    const state={sessionId,connectionId,pageKey,revision,manager,localEdits,...(navigationId&&navigationReady?{navigationId}:{}),...(fields?{fields}:{}),...(headerId?{headerId}:{}),...(todoId?{todoId}:{})}
    void api.timesheetChatSync(state).then(()=>{if(live)setMessage('描述工作内容即可自动填写右侧表单；保存、提交和审批仍需确认。')}).catch(e=>{if(live)setMessage(e instanceof Error?e.message:'Chat 同步失败')})
    return()=>{live=false}
  },[api,ready,sessionId,connectionId,pageKey,revision,manager])
  const stream=useCommands(),suggestion=stream.commands.timesheet
  useEffect(()=>{
    if(!ready||!sessionId||!suggestion||suggestion.revision!==version.current.revision||suggestion.id===seen.current)return
    if(suggestion.action.kind==='create'&&!isBusy.current){seen.current=suggestion.id;apply.current(suggestion.action);setMessage('Chat 已更新未保存表单，可继续描述要修改的内容。')}
    else setProposal(suggestion)
  },[ready,sessionId,suggestion])
  useEffect(()=>{if(ready&&stream.error!==undefined)setMessage(stream.error)},[ready,stream.error])
  const p=proposal?.revision===revision?proposal:undefined
  return <div className="oryh-timesheet-chat"><div className="chat-context-status"><p role="status">{message}</p><Button size="small" appearance="subtle" disabled={!sessionId||busy} onClick={()=>setRetry(n=>n+1)}>重新同步</Button></div>{p&&<section className="surface"><h2>Chat 建议 · {titles[p.action.kind]}</h2><p>尚未保存或执行。请核对后应用；服务端写入还需要正式确认。</p>{p.action.fields&&<p>{p.action.fields.period_start} — {p.action.fields.period_end}<br/>{p.action.fields.source_report_text}</p>}{(p.action.fields||p.action.line)&&<div className="table-scroll"><table><thead><tr><th>日期</th><th>小时</th><th>工作任务</th><th>备注</th></tr></thead><tbody>{(p.action.fields?.entries??[p.action.line!]).map((l,i)=><tr key={i}><td>{l.work_date}</td><td>{l.hours}</td><td>{l.task}</td><td>{l.notes}</td></tr>)}</tbody></table></div>}{p.action.headerId&&<p>工时编号：{p.action.headerId}</p>}{p.action.decision&&<p>审批意见：{({approved:'通过',rejected:'拒绝',returned:'退回修改'})[p.action.decision]} · {p.action.comment}</p>}<div className="toolbar"><Button appearance="primary" disabled={busy||(dirty&&p.action.kind!=='create')} onClick={()=>{seen.current=p.id;setProposal(undefined);onApply(p.action)}}>{p.action.kind==='create'?(dirty?'替换当前表单内容':'应用到工时表单'):'核对操作'}</Button><Button disabled={busy} onClick={()=>{seen.current=p.id;setProposal(undefined)}}>忽略建议</Button></div>{dirty&&<p>当前有未保存修改；应用填写建议会替换当前表单，其他操作请先保存或放弃修改。</p>}</section>}</div>
}
