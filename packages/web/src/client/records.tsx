import {useViewPreference,textPreference,pagePreference,productPreference,queryFieldsPreference,PreferenceDetails} from './view-preferences.js'
import {ProductPicker} from './product-picker.js'
import {recordColumns,recordDefaultColumns} from '@oryh/ai-client-records'
import type {ChatNavigation} from '@oryh/dsh-host/types'
import {useEffect,useRef,useState} from 'react'
import {Button,Field,Input} from '@fluentui/react-components'
import type {RecordKind,RecordPage,BusinessRecord,ProductOption} from '@oryh/ai-client-records'
import type {PageContext} from './workbench.js'
import {useOryhRemote} from './remote.js'
export const recordTitles:Record<RecordKind,string>={'sales-orders':'销售订单','inventory-items':'库存余额','inventory-item-details':'库存流水',shipments:'Shipment · 收发货'}
export const isRecordKind=(value:string):value is RecordKind=>Object.hasOwn(recordTitles,value)
const queryLabels:Record<RecordKind,string>={'sales-orders':'订单号、名称或客户关键词','inventory-items':'仓库名称（精确匹配）','inventory-item-details':'库存项编号（精确匹配）',shipments:'单号、承运商或运单关键词'}
export function RecordPanel({kind,filterCommand,columns,onColumns,connectionId,onContext}:{filterCommand?:ChatNavigation;columns:string[];onColumns:(columns:string[])=>void;kind:RecordKind;connectionId:string;onContext:(value:PageContext)=>void}){
 const catalog=recordColumns(kind)
 const api=useOryhRemote(),callback=useRef(onContext);callback.current=onContext
 const [data,setData]=useState<RecordPage>(),[selected,setSelected]=useState<BusinessRecord>(),[page,setPage]=useViewPreference(`${kind}:page`,1,pagePreference),[query,setQuery]=useViewPreference(`${kind}:query`,'',textPreference),[search,setSearch]=useViewPreference(`${kind}:search`,'',textPreference),[reload,setReload]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('')
 const [queryFields,setQueryFields]=useViewPreference<string[]>(`${kind}:queryFields`,[],queryFieldsPreference),[products,setProducts]=useViewPreference<ProductOption[]>(`${kind}:products`,[],productPreference),[appliedProducts,setAppliedProducts]=useViewPreference<ProductOption[]>(`${kind}:appliedProducts`,[],productPreference)
 const handledFilter=useRef('')
 function configureFields(fields:string[]){setQueryFields(fields);if(!fields.includes('product_code')){setProducts([]);setAppliedProducts([]);setPage(1)}}
 useEffect(()=>{
  if(kind!=='inventory-item-details'||!filterCommand||filterCommand.id===handledFilter.current||filterCommand.expiresAt<Date.now())return
  handledFilter.current=filterCommand.id;configureFields(filterCommand.queryFields??[])
  if(filterCommand.products!==undefined){setProducts(filterCommand.products);setAppliedProducts(filterCommand.products);setSearch(query);setPage(1);setReload(v=>v+1)}
 },[filterCommand,kind])
 useEffect(()=>{let live=true;setBusy(true);setError('');setData(undefined);setSelected(undefined);void api.recordList({connectionId,kind,page,query:search,...(kind==='inventory-item-details'?{productIds:appliedProducts.map(p=>p.id)}:{})}).then(value=>{if(live){setData(value);if(page>Math.max(1,value.pages))setPage(Math.max(1,value.pages))}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'查询失败')}).finally(()=>{if(live)setBusy(false)});return()=>{live=false}},[api,connectionId,kind,page,search,reload,appliedProducts])
 useEffect(()=>{callback.current({key:`${kind}:${selected?.id??'list'}`,title:selected?.title??recordTitles[kind],detail:search||'默认查询',scope:appliedProducts.length?'产品关联查询 · 只读':'服务端分页 · 只读',queryFields,productIds:appliedProducts.map(p=>p.id),columns,availableColumns:Object.entries(catalog).map(([id,label])=>({id,label})),content:JSON.stringify({loading:busy,error,page: data?.page??page,pages:data?.pages,total:data?.total,query:search,productIds:appliedProducts.map(p=>p.id),queryDraft:{inventory_item_id:query,products},availableQueryFields:kind==='inventory-item-details'?[{id:'product_code',label:'产品（多选）'}]:[],fetchedAt:data?.fetchedAt,selected,visibleRows:selected?[]:data?.rows??[]})})},[kind,selected,busy,error,page,search,data,columns,queryFields,appliedProducts,query,products])
 return <section className="business-page oryh-records" aria-busy={busy}>
  <header className="business-page-header">{selected&&<Button appearance="subtle" onClick={()=>setSelected(undefined)}>← 返回列表</Button>}<div className="list-actions"><h1>{selected?selected.title:recordTitles[kind]}</h1>{!selected&&<Button disabled={busy} onClick={()=>setReload(v=>v+1)}>刷新</Button>}</div></header>
  {error&&<p role="alert">{error}</p>}
  {selected?<div className="surface document-detail"><h2>记录信息</h2><p className="data-caption">来源：ORYH · {data?.fetchedAt&&new Date(data.fetchedAt).toLocaleString()}</p><dl className="document-fields">{selected.fields.map(f=><div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl></div>:<>
   <section className="surface table-surface"><form className="record-search" onSubmit={e=>{e.preventDefault();setPage(1);setSearch(query);setAppliedProducts(products);setReload(v=>v+1)}}><Field label={queryLabels[kind]}><Input value={query} onChange={(_,d)=>setQuery(d.value)} maxLength={200}/></Field>{kind==='inventory-item-details'&&queryFields.includes('product_code')&&<Field label="产品（多选）"><ProductPicker connectionId={connectionId} value={products} onChange={setProducts}/></Field>}<Button type="submit" disabled={busy}>查询</Button><Button type="button" onClick={()=>{setQuery('');setSearch('');setProducts([]);setAppliedProducts([]);setPage(1);setReload(v=>v+1)}}>清空条件</Button></form>
   <div className="list-configuration">{kind==='inventory-item-details'&&<PreferenceDetails preferenceKey={`${kind}:fieldsOpen`} className="advanced-filters"><summary>查询字段</summary><label><input type="checkbox" checked={queryFields.includes('product_code')} onChange={e=>configureFields(e.target.checked?['product_code']:[])}/>产品</label></PreferenceDetails>}
   <PreferenceDetails preferenceKey={`${kind}:columnsOpen`} className="advanced-filters"><summary>显示列</summary><div className="project-column-options">{Object.entries(catalog).map(([id,label])=><label key={id}><input type="checkbox" checked={columns.includes(id)} disabled={columns.length===1&&columns.includes(id)} onChange={e=>onColumns(e.target.checked?[...columns,id]:columns.filter(c=>c!==id))}/>{label}</label>)}<Button size="small" appearance="subtle" onClick={()=>onColumns([...recordDefaultColumns[kind]])}>恢复默认列</Button></div></PreferenceDetails>
   </div>{kind==='inventory-item-details'&&<p className="data-caption">库存流水为追加记录；默认查询活动库存项，指定库存项编号可查看其历史。</p>}
   {busy?<p role="status">正在读取…</p>:data&&<div><div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c}>{catalog[c]}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id}>{columns.map((c,index)=><td key={c}>{index===0?<button className="record-link" onClick={()=>setSelected(row)}>{row.fields.find(f=>f.label===catalog[c])?.value??'—'}</button>:row.fields.find(f=>f.label===catalog[c])?.value??'—'}</td>)}</tr>)}</tbody></table></div>{!data.rows.length&&<p className="record-empty">没有符合条件的记录</p>}<footer className="table-footer"><span>共 {data.total} 条 · 当前 {data.rows.length} 条</span><div className="pagination"><Button size="small" disabled={page<=1} onClick={()=>setPage(v=>v-1)}>上一页</Button><span>{page} / {data.pages}</span><Button size="small" disabled={page>=data.pages} onClick={()=>setPage(v=>v+1)}>下一页</Button></div></footer></div>}
  </section></>}
 </section>
}
