import { connectionId } from './brand.js'
import type { ConnectionSummary } from './connections.js'
import type { OryhHttpClient } from './http.js'
import { OryhClientError } from './errors.js'
import { object } from './expense-contracts.js'
export interface TodoDocument { todoId: string; title: string; entityType: string; entityId: string; fetchedAt: string; sections: { name: string; fields: { name: string; value: string }[] }[] }
const routes: Record<string,{path:string;root:string}>={
  purchase_request:{path:'purchase-requests',root:'request'}, purchase_order:{path:'purchase-orders',root:'po'},
  sales_quotation:{path:'sales-quotations',root:'quotation'}, sales_order:{path:'sales-orders',root:'order'},
  timesheet_header:{path:'timesheet-headers',root:'header'},expense_claim:{path:'expense-claims',root:'claim'},
}
// Explicit business projection. Custom fields, attachments, metadata and credentials never enter chat.
const fields=new Set(('id employee_id title description status todo_type due_at entity_type entity_id quote_number revision_no order_no po_number request_date needed_by vendor_name_snapshot customer_name_snapshot currency submitted_at source_report_text created_at updated_at quote_date valid_until payment_terms delivery_terms total_amount remarks outcome_note period_start period_end claim_date computed_total estimated_total adjustments_total adjusted_total unpriced_item_count pending_sku_count product_name_snapshot product_code sku_code name spec unit quantity unit_price list_price amount line_total tax_rate discount_rate tax_amount notes task hours work_date work_type project_name_snapshot category expense_date merchant round_no sequence_no action comment approver_id approver_role acted_at adjustment_type reason').split(' '))
function project(value:unknown, path:string, output:TodoDocument['sections'],depth=0):void {
  if(depth>5)return
  if(Array.isArray(value)){value.forEach((v,i)=>project(v,`${path} ${i+1}`,output,depth+1));return}
  if(!value||typeof value!=='object')return
  const entries=Object.entries(value),flat=entries.filter(([k,v])=>fields.has(k)&&(v===null||['string','number','boolean'].includes(typeof v))).map(([name,v])=>({name,value:v===null?'—':String(v)}))
  if(flat.length)output.push({name:path,fields:flat})
  for(const [key,v]of entries)if(['items','entries','approval_records','quotation','request','order','po','header','claim','product','sku','adjustments'].includes(key))project(v,`${path}/${key}`,output,depth+1)
}
export class TodoDetailService {
  constructor(private http:OryhHttpClient,private connection:(id:string)=>ConnectionSummary,private verify:(id:string)=>Promise<ConnectionSummary>){}
  async read(id:string,todoId:string):Promise<TodoDocument>{
    await this.verify(id)
    const c=this.connection(id),scope=JSON.stringify(c.identity),employee=c.identity.user.employeeId
    if(!employee)throw new OryhClientError('账号未关联员工。','employee-required')
    const guard=()=>{if(JSON.stringify(this.connection(id).identity)!==scope)throw new OryhClientError('企业身份已改变。','connection-identity-mismatch')}
    const todo=object(object(await this.http.request(connectionId(id),{path:`/todos/${encodeURIComponent(todoId)}`})).data);guard()
    if(todo.id!==todoId||todo.employee_id!==employee)throw new OryhClientError('只能读取分配给当前员工的待办。','cross-connection-result')
    const entityType=String(todo.entity_type),entityId=String(todo.entity_id),route=routes[entityType]
    if(!route)throw new OryhClientError('此待办类型尚未接入关联详情查询，请在 ORYH 查看。','operation-not-found')
    const detail=object(object(await this.http.request(connectionId(id),{path:`/${route.path}/${encodeURIComponent(entityId)}/detail`})).data);guard()
    if(object(detail[route.root]).id!==entityId)throw new OryhClientError('关联单据与待办不匹配。','invalid-response')
    const sections:TodoDocument['sections']=[];project(todo,'todo',sections);project(detail,entityType,sections)
    return {todoId,title:String(todo.title),entityType,entityId,fetchedAt:new Date().toISOString(),sections}
  }
}
