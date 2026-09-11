import {requirePage} from './access.js'
import type {RecordKind,RecordQuery,RecordPage,BusinessRecord,OryhRecordRemote,ProductSearch,ProductOptions,ProductOption} from './record-contracts.js'
import type {ConnectionSummary} from './connections.js'
import type {OryhHttpClient} from './http.js'
import type {ConnectionId} from './brand.js'
import {OryhClientError} from './errors.js'
import {recordSpecs as specs} from './record-views.js'

import {inventoryProductQuery} from './inventory-product-query.js'

const fail=()=>new OryhClientError('业务查询参数或返回数据无效。','request-failed')
export function decodeRecordPage(kind:RecordKind,body:unknown,page:number):RecordPage{
 const spec=specs[kind];if(!spec||!body||typeof body!=='object')throw fail()
 const envelope=body as {data?:unknown;meta?:{total?:unknown;pages?:unknown}}
 if(!Array.isArray(envelope.data)||!Number.isSafeInteger(envelope.meta?.total)||!Number.isSafeInteger(envelope.meta?.pages))throw fail()
 const rows=envelope.data.map((value:unknown):BusinessRecord=>{
  if(!value||typeof value!=='object'||typeof (value as {id?:unknown}).id!=='string')throw fail()
  const r=value as Record<string,unknown>,str=(k:string)=>r[k]==null?'':typeof r[k]==='string'||typeof r[k]==='number'?String(r[k]):''
  return {id:str('id'),title:str(spec.title)||str('id'),status:str('status')||str('item_status'),summary:str(spec.summary),date:str(spec.date),fields:[{label:'编号',value:str('id')},...Object.entries(spec.fields).map(([key,label])=>({label,value:str(key)||'—'}))]}
 })
 return {rows,page,pages:Math.max(1,envelope.meta!.pages as number),total:envelope.meta!.total as number,fetchedAt:new Date().toISOString()}
}
export class RecordService implements OryhRecordRemote {
 constructor(private http:OryhHttpClient,private verify:(id:string)=>Promise<ConnectionSummary>,private current:(id:string)=>ConnectionSummary){}
 async productSearch(q:ProductSearch):Promise<ProductOptions>{
  if(typeof q.query!=='string'||q.query.length>200||!Number.isSafeInteger(q.page)||q.page<1||q.ids!==undefined&&(!Array.isArray(q.ids)||q.ids.length>50||q.ids.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(q.ids).size!==q.ids.length))throw fail()
  const c=await this.verify(q.connectionId),scope=(v:ConnectionSummary)=>JSON.stringify([v.origin,v.identity.tenant.id,v.identity.user.id])
  const read=async(path:`/${string}`)=>{if(scope(c)!==scope(this.current(q.connectionId)))throw fail();const body=await this.http.request(q.connectionId as ConnectionId,{path});if(scope(c)!==scope(this.current(q.connectionId)))throw fail();return body}
  requirePage(c.identity,'inventory-item-details')
  const decode=(value:unknown):ProductOption=>{const p=value as Record<string,unknown>;if(!p||typeof p.id!=='string'||typeof p.name!=='string')throw fail();return {id:p.id,name:p.name,code:typeof p.product_code==='string'?p.product_code:''}}
  if(q.ids){const rows:ProductOption[]=[];for(const id of q.ids){const body=await read(`/products/${encodeURIComponent(id)}`) as {data:unknown};const option=decode(body.data);if(option.id!==id)throw fail();rows.push(option)}return {rows,total:rows.length,pages:1}}
  const params=new URLSearchParams({keyword:q.query.trim(),page:String(q.page),size:'20'})
  const body=await read(`/products?${params}`) as {data:unknown[];meta:{total:number;pages:number}}
  if(!Array.isArray(body?.data)||!Number.isSafeInteger(body.meta?.total)||!Number.isSafeInteger(body.meta?.pages))throw fail()
  return {rows:body.data.map(decode),total:body.meta.total,pages:Math.max(1,body.meta.pages)}
 }
 async recordList(q:RecordQuery){
  if(!Object.hasOwn(specs,q.kind)||!Number.isSafeInteger(q.page)||q.page<1||typeof q.query!=='string'||q.query.length>200)throw fail()
  if(q.productIds!==undefined&&(q.kind!=='inventory-item-details'||!Array.isArray(q.productIds)||q.productIds.length>50||q.productIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(q.productIds).size!==q.productIds.length||!!q.productCode?.trim()))throw fail()
  if(q.productCode!==undefined&&(q.kind!=='inventory-item-details'||typeof q.productCode!=='string'||q.productCode.length>200))throw fail()
  const c=await this.verify(q.connectionId),scope=(v:ConnectionSummary)=>JSON.stringify([v.origin,v.identity.tenant.id,v.identity.user.id])
  requirePage(c.identity,q.kind)
  const params=new URLSearchParams({page:String(q.page),size:'25'});if(q.query.trim())params.set(specs[q.kind].query,q.query.trim())
  const read=async(path:`/${string}`)=>{if(scope(c)!==scope(this.current(q.connectionId)))throw new OryhClientError('企业连接已变化，请重新查询。','cross-connection-result');return this.http.request(q.connectionId as ConnectionId,{path})}
  const body=q.productCode?.trim()||q.productIds?.length?await inventoryProductQuery(q,read):await read(`/${q.kind}?${params}`)
  if(scope(c)!==scope(this.current(q.connectionId)))throw new OryhClientError('企业连接已变化，请重新查询。','cross-connection-result')
  const result=decodeRecordPage(q.kind,body,q.page)
  if(q.kind==='inventory-item-details'){
   // Resolve only inventory positions present on this page, through the same tenant connection.
   const ids=[...new Set(result.rows.map(row=>row.fields.find(f=>f.label==='库存项编号')?.value).filter((id):id is string=>!!id&&id!=='—'))]
   const positions=new Map<string,Record<string,unknown>>()
   for(let offset=0;offset<ids.length;offset+=5)await Promise.all(ids.slice(offset,offset+5).map(async id=>{
    try{
     const response=await this.http.request(q.connectionId as ConnectionId,{path:`/inventory-items/${encodeURIComponent(id)}`}) as {data?:Record<string,unknown>}
     if(response.data?.id===id)positions.set(id,response.data)
    }catch{/* Missing or inaccessible relations remain explicitly unavailable. */}
   }))
   if(scope(c)!==scope(this.current(q.connectionId)))throw new OryhClientError('企业连接已变化，请重新查询。','cross-connection-result')
   for(const row of result.rows){const position=positions.get(row.fields.find(f=>f.label==='库存项编号')?.value??'');for(const [key,label] of [['product_code','产品编码'],['facility','仓库']] as const){const field=row.fields.find(f=>f.label===label);if(field)field.value=typeof position?.[key]==='string'?position[key] as string:'—'}}
  }
  return result
 }
}
