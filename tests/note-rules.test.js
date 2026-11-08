'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const rules=require('../public/note-rules-core'),notes=require('../public/footnotes-core'),publication=require('../public/publication-core');
const {buildMockDom}=require('./visual-harness'),core=require('../public/app-core');
const makeRule=(n,decisions)=>({path:n.path,xmlPath:n.xmlPath,expectedNote:n.before,expectedContext:n.context,expectedConditions:n.conditions,confirmed:true,decisions});
const common={scope:'common',models:[]},forModel=model=>({scope:'models',models:[model]});
function prepare(files,config,model){const p=rules.project(files,config,model);assert.deepEqual(p.issues,[]);return publication.preparePublication({map:{children:[{type:'file',path:'a.dita'}]},files:p.files,model,ruleConfirmed:p.confirmed,ruleExclusions:p.excluded},core.collectPreviewPaths);}
test('external rules retain common and rich fragments without changing DITA',async()=>{
 buildMockDom();const source="<?xml version='1.0' encoding='GBK'?>\r\n<topic id='a'><title>T</title><body><p id='p'>Command<fn>通用。<div>M100：<b>支持</b>。M300：<i>不同</i>。</div></fn>Tail<fn>Unassigned</fn></p></body></topic>",files=new Map([['a.dita',{current:source}]]),n=notes.listFootnotes(source,'a.dita')[0],config={schema:1,rules:[makeRule(n,[common,forModel('M100'),forModel('M300')])]};
 for(const [model,keep,omit]of [['M100','支持','不同'],['M300','不同','支持']]){const data=prepare(files,config,model);assert.equal(data.report.unmarked,1);assert.match(data.notes[0].xml,/通用/);const input={map:{title:'T',children:[{type:'file',path:'a.dita'}]},files,model,publicationData:data};for(const output of [await core.exportMapToHtml(input),await core.exportMapToMarkdown(input)]){assert.match(output,new RegExp(keep));assert.doesNotMatch(output,new RegExp(omit));}}
 assert.equal(files.get('a.dita').current,source);assert.equal(rules.project(files,config,'').files.get('a.dita').current,source);
});
test('empty ruled definitions and repeated references disappear and visible notes renumber',()=>{
 const source='<topic id="a"><title>T</title><body><fn id="shared">X_ONLY。</fn><p>First<xref type="fn" href="#a/shared"/> Again<xref type="fn" href="#a/shared"/> Tail<fn>COMMON</fn></p></body></topic>',files=new Map([['a.dita',{current:source}]]),n=notes.listFootnotes(source,'a.dita')[0],config={schema:1,rules:[makeRule(n,[forModel('X1')])]};
 const data=prepare(files,config,'Y2');assert.equal(data.notes.length,1);assert.equal(data.notes[0].number,1);assert.doesNotMatch(data.files.get('a.dita').current,/X_ONLY|href="#a\/shared"/);assert.equal(prepare(files,config,'X1').notes.length,2);
});
test('public conrefs use rules bound to their original source',()=>{
 const source='<topic id="s"><body><p id="p">Value<fn><div>A1：ONE。</div><div>B2：TWO。</div></fn></p></body></topic>',files=new Map([['a.dita',{current:'<topic id="a"><body><p conref="shared.dita#s/p"/></body></topic>'}],['shared.dita',{current:source}]]),n=notes.listFootnotes(source,'shared.dita')[0],data=prepare(files,{schema:1,rules:[makeRule(n,[forModel('A1'),forModel('B2')])]},'B2');assert.equal(data.notes.length,1);assert.match(data.notes[0].xml,/TWO/);assert.doesNotMatch(data.notes[0].xml,/ONE/);assert.equal(files.get('shared.dita').current,source);
});
test('changed note, context or conditions invalidate rules, and another manual never reuses them',()=>{
 const source='<topic><body><p>Command<fn>A1：One。</fn></p></body></topic>',n=notes.listFootnotes(source,'a.dita')[0],config={schema:1,rules:[makeRule(n,[forModel('A1')])]};for(const changed of [source.replace('One','Changed'),source.replace('Command','Other'),source.replace('<p>','<p product="A1">')])assert.equal(rules.project(new Map([['a.dita',{current:changed}]]),config,'A1').issues.length,1);assert.equal(rules.project(new Map([['other.dita',{current:source}]]),config,'A1').applied,0);
});
test('whole-model suggestions require confirmation and reject invalid sources or partitions',()=>{
 const source='<topic><body><p><fn>BX-7 不支持。BX-70 支持。通用。</fn></p></body></topic>',n=notes.listFootnotes(source,'mqtt.dita')[0],s=rules.suggest(n,['BX-7','BX-70']);assert.deepEqual(s.map(p=>p.models),[['BX-7'],['BX-70'],[]]);assert.ok(s.every(p=>p.scope==='pending'));assert.throws(()=>rules.validate({schema:1,rules:[makeRule(n,s.map(p=>({scope:p.scope,models:p.models})))]}),/确认/);const wrong=makeRule(n,[forModel('BX-7')]);assert.throws(()=>rules.validate({schema:1,rules:[wrong]}),/片段/);wrong.path='../outside.dita';assert.throws(()=>rules.validate({schema:1,rules:[wrong]}),/来源/);
});
test('all 37 notes in the HTTP manual dependency closure partition without altering text or markup',()=>{
 const {collectDemoFiles}=require('../scripts/demo-workspace'),{decodeXmlBuffer}=require('../lib/document-files');
 const files=collectDemoFiles(path.join(__dirname,'../examples/http_httpsusermanual'),'http_httpsusermanual.ditamap');
 let count=0;for(const [p,bytes]of files)if(p.endsWith('.dita')){
  const source=decodeXmlBuffer(bytes);for(const n of notes.listFootnotes(source,p)){
   const parts=rules.partition(n);assert.equal(parts.render(parts.parts.map(()=>common),'CHECK'),n.inner);
   assert.equal(source.slice(n.start,n.end),n.before);count++;
  }
 }assert.equal(count,37);
});
