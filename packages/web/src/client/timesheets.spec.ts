// @vitest-environment jsdom
import {act,createElement as h} from 'react'
import {createRoot} from 'react-dom/client'
import {describe,it,expect,vi} from 'vitest'
import {TimesheetPanel} from './timesheets.js'
import {RemoteContext} from './remote.js'
import {LocaleContext,dictionaries} from './locale.js'
// Test the business interaction; native Fluent rendering is checked in the browser.
vi.mock('@fluentui/react-components',()=>({
  Button:({appearance,children,...props}:any)=>h('button',{type:'button',...props},children),
  Dialog:({open,children}:any)=>open?h('div',{role:'dialog'},children):null,
  ...Object.fromEntries(['DialogActions','DialogBody','DialogContent','DialogSurface','DialogTitle'].map(name=>[name,({children}:any)=>h('div',null,children)])),
}))
vi.mock('./timesheet-chat.js' ,()=>({TimesheetChat:()=>null}))

describe('timesheet save feedback',()=>{
  it('shows pending and failure beside save, preserves input, and opens review after retry',async()=>{
    globalThis.IS_REACT_ACT_ENVIRONMENT=true
    let reject!:(e:Error)=>void
    const prepare=vi.fn().mockImplementationOnce(()=>new Promise((_,r)=>{reject=r})).mockResolvedValue({id:'review',action:{kind:'create',fields:{period_start:'2026-09-09',period_end:'2026-09-09',entries:[]}},expiresAt:Date.now()+60000})
    const confirm=vi.fn()
    const api={timesheetList:async()=>[],timesheetOptions:async()=>({workTypes:[],projects:[],requirements:[],submitStates:[],editableStates:[]}),timesheetHistory:async()=>[],timesheetPrepare:prepare,timesheetConfirm:confirm}
    const node=document.createElement('div');document.body.append(node);const root=createRoot(node)
    try{
      await act(async()=>root.render(h(RemoteContext.Provider,{value:api as never},h(LocaleContext.Provider,{value:k=>dictionaries[k]},h(TimesheetPanel,{connection:{id:'c',identity:{permissions:['timesheet.submit_own','approval.record'],tenant:{name:'Test'},user:{email:'test@example.invalid'}}} as never,manager:false,active:false,navigationId:'open',onDirtyChange:()=>{}})))))
      await act(async()=>Array.from(node.querySelectorAll('button')).find(b=>b.textContent==='新建工时单')!.click())
      const form=node.querySelector('form')!, before=Array.from(form.querySelectorAll('input,select,textarea')).map(e=>(e as HTMLInputElement).value)
      await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
      expect(form.querySelector('[role=status]')?.textContent).toBe('正在核对…')
      expect(form.querySelector('fieldset')?.disabled).toBe(true)
      await act(async()=>reject(Error('这个期间已有工时单')))
      expect(form.querySelector('.oryh-ts-save-feedback [role=alert]')?.textContent).toBe('这个期间已有工时单')
      expect(Array.from(form.querySelectorAll('input,select,textarea')).map(e=>(e as HTMLInputElement).value)).toEqual(before)
      expect(form.querySelector('fieldset')?.disabled).toBe(false)
      await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
      expect(document.querySelector('[role=dialog]')?.textContent).toContain('核对本次操作')
      expect(confirm).not.toHaveBeenCalled()
    }finally{await act(async()=>root.unmount());node.remove()}
  })
})

describe('existing timesheet view modes',()=>{
 it.each([true,false])('opens the requested record with server-controlled editability (%s)',async(canEdit)=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const detail={canEdit,header:{id:'h',employee_id:'employee',period_start:'2026-09-01',period_end:'2026-09-01',status:canEdit?'draft':'submitted',source_report_text:''},entries:[{id:'line',work_date:'2026-09-01',hours:8,work_type:'regular',project_id:'',task:'existing work',notes:''}],approval_records:[]}
  const open=vi.fn().mockResolvedValue(detail)
  const api={timesheetList:async()=>[],timesheetOptions:async()=>({workTypes:[{name:'regular',title:'正常工时'}],projects:[],requirements:[],submitStates:['draft'],editableStates:['draft']}),timesheetHistory:async()=>[],timesheetDetail:open}
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node)
  try{
   await act(async()=>root.render(h(RemoteContext.Provider,{value:api as never},h(LocaleContext.Provider,{value:k=>dictionaries[k]},h(TimesheetPanel,{connection:{id:'c',identity:{permissions:['timesheet.submit_own','approval.record'],tenant:{name:'Test'},user:{email:'test@example.invalid'}}} as never,manager:false,active:true,navigationId:'open',navigation:{id:'open',headerId:'h',expiresAt:Date.now()+15000},onDirtyChange:()=>{}})))))
   expect(open).toHaveBeenCalledWith('c','h',undefined)
   expect(node.textContent).toContain(canEdit?'编辑工时':'工时详情 · 只读')
   expect(node.querySelectorAll('form input[type=number]').length).toBe(canEdit?1:0)
   if(canEdit)expect(Array.from(node.querySelectorAll('input')).some(e=>e.value==='existing work')).toBe(true)
   else expect(node.textContent).toContain('existing work')
  }finally{await act(async()=>root.unmount());node.remove()}
 })
})
