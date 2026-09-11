import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ProjectTable} from './project-columns.js'
it('renders requested columns in order with the server creation timestamp',()=>{
 const html=renderToStaticMarkup(createElement(ProjectTable,{projects:[{id:'p',name:'项目',status:'active',code:null,client:null,startDate:null,endDate:null,createdAt:'2026-09-01T08:00:00Z'}],columns:['name','createdAt','client'],onOpen:()=>{}}))
 expect(html).toContain('dateTime="2026-09-01T08:00:00Z"')
 expect(html.indexOf('项目名称')).toBeLessThan(html.indexOf('创建时间'))
 expect(html.indexOf('创建时间')).toBeLessThan(html.indexOf('客户'))
 expect(html).not.toContain('开始日期')
 expect(html).toContain('—')
})
