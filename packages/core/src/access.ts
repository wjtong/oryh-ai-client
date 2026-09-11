import type {OryhIdentity} from './contracts.js'
import {OryhClientError} from './errors.js'
export type AccessPage='my-open-todos'|'my-expense-claims'|'timesheets'|'timesheet-approvals'|'list-projects'|'sales-orders'|'inventory-items'|'inventory-item-details'|'shipments'|'settings'
export function hasPermission(identity:OryhIdentity,verb:string):boolean {
 const p=identity.permissions??[]
 return p.includes(verb)||p.includes(`${verb}:*`)||(verb==='shipment.manage'&&hasPermission(identity,'inventory.manage'))
}
// Product entry policy, using server grants rather than role names. Read APIs may
// be broader; these rules do not claim to replace ORYH's row-level authorization.
export function canAccessPage(identity:OryhIdentity,page:string):boolean {
 const any=(...verbs:string[])=>verbs.some(v=>hasPermission(identity,v))
 switch(page){
 case 'settings':return true
 case 'my-open-todos':return Boolean(identity.user.employeeId)
 case 'timesheets':return Boolean(identity.user.employeeId)&&any('timesheet.submit_own','timesheet.advance','approval.record')
 case 'timesheet-approvals':return Boolean(identity.user.employeeId)&&any('approval.record')
 case 'my-expense-claims':return Boolean(identity.user.employeeId)&&any('expense.submit_own','expense.advance','approval.record')
 case 'list-projects':return any('master_data.manage','users.manage')
 case 'sales-orders':return any('order.submit_own','order.advance','approval.record')
 case 'inventory-items':case 'inventory-item-details':return any('inventory.manage')
 case 'shipments':return any('shipment.manage')
 default:return false
 }
}
export function requirePage(identity:OryhIdentity,page:string):void {
 if(!canAccessPage(identity,page))throw new OryhClientError('当前账号没有此业务功能的访问权限。','request-failed')
}
export function requirePermission(identity:OryhIdentity,verb:string):void {
 if(!hasPermission(identity,verb))throw new OryhClientError('当前账号没有执行此操作的权限。','request-failed')
}
