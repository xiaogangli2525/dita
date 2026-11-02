'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),reuse=require('../public/note-reuse-core'),{preparePublication}=require('../public/publication-core'),{createManualService}=require('../public/manual-service'),core=require('../public/app-core');
const files=input=>new Map(Object.entries(input).map(([path,current])=>[path,{current}]));
test('reuse candidates retain source conditions and exclude unnamed, alias and xml:base definitions',()=>{
 const result=reuse.list(files({'shared notes.dita':'<topic id="s" product="M100 M200"><body><fn id="public" product="M100">Text</fn><fn>Inline</fn><fn id="alias" conref="#s/public"/><p xml:base="x/"><fn id="based">Based</fn></p></body></topic>'}));
 assert.equal(result.length,1);assert.deepEqual(result[0].conditions,['M100 M200','M100']);assert.equal(reuse.href('topics/a.dita',result[0]),'../shared%20notes.dita#s/public');assert.equal(reuse.href('shared notes.dita',result[0]),'#s/public');
});
test('duplicate public IDs refuse ambiguous selection',()=>{assert.throws(()=>reuse.list(files({'a.dita':'<topic id="a"><body><fn id="n">A</fn><fn id="n">B</fn></body></topic>'})),/重复/);});
test('reuse export respects reference-location and source model conditions with continuous numbering',()=>{
 const input=files({'a.dita':'<topic id="a"><body><p product="M100">A<xref type="fn" href="s.dita#s/n"/></p><p product="M200">B<xref type="fn" href="s.dita#s/n"/></p><p><fn>Tail</fn></p></body></topic>','s.dita':'<topic id="s"><body><fn id="n" product="M100 M200">Shared</fn></body></topic>'});
 const snapshot={map:{children:[{type:'file',path:'a.dita'}]},files:input,project:{models:['M100','M200','M300']}},service=createManualService({ditaCore:core});
 for(const model of ['M100','M200']){const result=preparePublication({...snapshot,model},nodes=>nodes);assert.equal((result.files.get('a.dita').current.match(/type="fn"/g)||[]).length,1);assert.equal(result.notes.length,2);assert.equal(result.notes[0].number,1);}
 const result=service.listNotes(snapshot);assert.equal(result.notes[0].usages.length,2);assert.deepEqual(result.notes[0].usages.map(use=>use.conditions),[['M100 M200','M100'],['M100 M200','M200']]);
 const other=preparePublication({...snapshot,model:'M300'},nodes=>nodes);assert.equal(other.notes.length,1);assert.equal(other.notes[0].number,1);assert.doesNotMatch(other.files.get('a.dita').current,/type="fn"/);
});
