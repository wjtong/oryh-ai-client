import type {OryhProject} from '@oryh/ai-client-core/types'
import type {ProjectColumn} from '@oryh/dsh-host/types'
export const projectColumnLabels:Record<ProjectColumn,string>={name:'项目名称',code:'项目编码',status:'状态',client:'客户',startDate:'开始日期',endDate:'结束日期',createdAt:'创建时间',updatedAt:'更新时间'}
export const defaultProjectColumns:ProjectColumn[]=['name','status','client','startDate']
export function ProjectTable({projects,columns,onOpen}:{projects:OryhProject[];columns:ProjectColumn[];onOpen:(id:string)=>void}){
 return <div className="table-scroll"><table><caption className="sr-only">项目列表</caption><thead><tr>{columns.map(c=><th scope="col" key={c}>{projectColumnLabels[c]}</th>)}</tr></thead><tbody>{projects.map(p=><tr key={p.id}>{columns.map(c=><td key={c}>{c==='name'?<button className="record-link" data-row-id={p.id} onClick={()=>onOpen(p.id)}>{p.name}</button>:c==='status'?({active:'进行中',archived:'已归档'}[p.status]??p.status):(c==='createdAt'||c==='updatedAt')&&p[c]?<time dateTime={p[c]!}>{new Date(p[c]!).toLocaleString()}</time>:p[c]||'—'}</td>)}</tr>)}</tbody></table></div>
}
