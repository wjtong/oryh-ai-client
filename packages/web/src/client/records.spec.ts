// @vitest-environment jsdom
import {act,createElement as h} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import {RecordPanel} from './records.js'
import {RemoteContext} from './remote.js'
vi.mock('./product-picker.js',()=>({ProductPicker:()=>h('button',null,'选择产品')}))
vi.mock('@fluentui/react-components',()=>({Button:({appearance,size,children,...props}:any)=>h('button',props,children),Field:({label,children}:any)=>h('label',null,label,children),Input:({onChange,...props}:any)=>h('input',{...props,onChange:(e:any)=>onChange?.(e,{value:e.target.value})})}))
it('updates ledger columns and page context without fetching again, and retains record access',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const recordList=vi.fn(async()=>({rows:[{id:'r',title:'issued',fields:[{label:'产品编码',value:'P-1'},{label:'现存数量变动',value:'-1'},{label:'创建时间',value:'2026-09-01T08:00:00Z'}]}],page:1,pages:1,total:1,fetchedAt:''}))
 const api={recordList},onContext=vi.fn(),onColumns=vi.fn(),node=document.createElement('div'),root=createRoot(node)
 const render=(columns:string[])=>root.render(h(RemoteContext.Provider,{value:api as never},h(RecordPanel,{kind:'inventory-item-details',connectionId:'c',columns,onColumns,onContext})))
 try{
  await act(async()=>render(['quantity_on_hand_diff']))
  await act(async()=>render(['product_code','created_at','quantity_on_hand_diff']))
  expect(Array.from(node.querySelectorAll('th')).map(n=>n.textContent)).toEqual(['产品编码','创建时间','现存数量变动'])
  expect(node.querySelector('tbody')?.textContent).toContain('P-12026-09-01T08:00:00Z-1')
  expect(recordList).toHaveBeenCalledTimes(1)
  expect(onContext.mock.lastCall?.[0].columns).toEqual(['product_code','created_at','quantity_on_hand_diff'])
  await act(async()=>node.querySelector<HTMLButtonElement>('.record-link')!.click())
  expect(node.textContent).toContain('记录信息')
  expect(onContext.mock.lastCall?.[0].key).toBe('inventory-item-details:r')
 }finally{await act(async()=>root.unmount())}
})

it('adds a query control without querying and submits the product through the shared Remote',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const recordList=vi.fn(async()=>({rows:[],page:1,pages:1,total:0,fetchedAt:''})),api={recordList},onContext=vi.fn()
 const node=document.createElement('div'),root=createRoot(node)
 const render=(filterCommand?:any)=>root.render(h(RemoteContext.Provider,{value:api as never},h(RecordPanel,{kind:'inventory-item-details',connectionId:'c',columns:['id'],onColumns:()=>{},onContext,...(filterCommand?{filterCommand}:{})})))
 try{
  await act(async()=>render())
  await act(async()=>render({id:'add',target:'filters',queryFields:['product_code'],expiresAt:Date.now()+10000}))
  expect(node.textContent).toContain('产品（多选）')
  expect(recordList).toHaveBeenCalledTimes(1)
  await act(async()=>render({id:'query',target:'filters',queryFields:['product_code'],products:[{id:'p',code:'PT-HEAD',name:'打印头'}],expiresAt:Date.now()+10000}))
  expect(recordList.mock.lastCall?.[0]).toMatchObject({productIds:['p'],page:1})
  expect(onContext.mock.lastCall?.[0].productIds).toEqual(['p'])
  await act(async()=>Array.from(node.querySelectorAll('button')).find(b=>b.textContent==='清空条件')!.click())
  expect(recordList.mock.lastCall?.[0]).toMatchObject({productIds:[],query:'',page:1})
 }finally{await act(async()=>root.unmount())}
})
