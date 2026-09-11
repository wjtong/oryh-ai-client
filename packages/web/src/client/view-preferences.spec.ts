// @vitest-environment jsdom
import {beforeEach,it,expect} from 'vitest'
import {createViewPreference,filterPreference,pagePreference,queryFieldsPreference,productPreference} from './view-preferences.js'
beforeEach(()=>localStorage.clear())
it('restores filters, ordering and page, with functional updates and independent lists',()=>{
 const defaults={text:'',status:'',from:'',to:'',descending:true}
 const filter=createViewPreference('user','projects:filter',defaults,filterPreference)
 filter.set(v=>({...v,text:'ABC',status:'active',from:'2026-01-01',descending:false}))
 createViewPreference('user','projects:page',1,pagePreference).set(3)
 expect(createViewPreference('user','projects:filter',defaults,filterPreference).getSnapshot()).toMatchObject({text:'ABC',status:'active',descending:false})
 expect(createViewPreference('user','projects:page',1,pagePreference).getSnapshot()).toBe(3)
 expect(createViewPreference('user','todos:filter',defaults,filterPreference).getSnapshot()).toEqual(defaults)
})
it('rejects invalid persisted shapes and strips extra data',()=>{
 localStorage.setItem('oryh.view.v1:u:page','-1')
 expect(createViewPreference('u','page',1,pagePreference).getSnapshot()).toBe(1)
 localStorage.setItem('oryh.view.v1:u:fields','["unknown"]')
 expect(createViewPreference('u','fields',[],queryFieldsPreference).getSnapshot()).toEqual([])
 localStorage.setItem('oryh.view.v1:u:products',JSON.stringify([{id:'p',name:'Product',code:'P1',extra:'discard'}]))
 expect(createViewPreference('u','products',[],productPreference).getSnapshot()).toEqual([{id:'p',name:'Product',code:'P1'}])
})
