'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createReleaseStore}=require('../public/release-store'),{createDraftStore}=require('../public/draft-store');
function storage(){const data=new Map();return{data,get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
test('corrupt or unavailable release history cannot masquerade as empty or be overwritten on append',()=>{
 for(const value of ['{broken','{}','[null]']){
  const raw=storage();raw.setItem('dita.releases.v1:"/repo"',value);const store=createReleaseStore(raw);
  assert.throws(()=>store.list('/repo'),/读取失败|格式损坏/);assert.throws(()=>store.append('/repo',{schema:1,manualPath:'a.ditamap'}));assert.equal(raw.getItem('dita.releases.v1:"/repo"'),value);
 }
 assert.throws(()=>createReleaseStore({getItem(){throw Error('denied');}}).list('/repo'),/读取失败/);
});
test('damaged drafts remain stored alongside recoverable drafts and storage denial propagates',()=>{
 const raw=storage(),scope={root:'/repo',branch:'main'},store=createDraftStore(raw);
 store.put(scope,{path:'a.dita',disk:'before',current:'after',dirty:true});raw.setItem('dita.draft.v1:damaged','{broken');
 assert.equal(store.list(scope).length,1);assert.equal(store.warnings.length,1);assert.equal(raw.getItem('dita.draft.v1:damaged'),'{broken');
 assert.throws(()=>createDraftStore({length:1,key:()=> 'dita.draft.v1:a',getItem(){throw Error('blocked');}}).list(scope),/blocked/);
});
