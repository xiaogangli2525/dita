'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const notes=require('../public/footnotes-core'),scope=require('../public/model-note-text'),rules=require('../public/note-rules-core');
const profiling=require('../public/profiling-core'),publication=require('../public/publication-core'),core=require('../public/app-core');
const {buildMockDom}=require('./visual-harness');
const note=inner=>notes.listFootnotes('<topic><body><p>Command<fn>'+inner+'</fn></p></body></topic>','a.dita')[0];

test('explicit prefix filtering keeps common text, exact model branches and inline markup',()=>{
  const original=note('通用说明。<div><b>BX-7/BX-70：</b>第一句。第二句<varname>&lt;value&gt;</varname>。</div><div>BX-70：另一说明。</div>');
  const result=scope.analyze(original,'BX-7',{knownModels:['BX-7','BX-70']});
  assert.deepEqual(result.unresolved,[]);assert.match(result.inner,/通用说明/);assert.match(result.inner,/<b>BX-7：<\/b>/);assert.match(result.inner,/第二句<varname>/);assert.doesNotMatch(result.inner,/BX-70|另一说明/);
  assert.match(original.inner,/BX-70/);
  assert.equal(scope.analyze(note('BX-7-MU：变体。'),'BX-7').inner,'');
});

test('nested model branches override textual labels while product filters remain authoritative',()=>{
  const original=note('<div>BX-7：父说明。<div>BX-70：子说明。</div></div><div product="tbd">BX-70：待定说明。</div>');
  const profile=profiling.compile('<val><prop action="exclude" att="product" val="tbd"/></val>');
  const result=scope.analyze(original,'BX-70',{profile});
  assert.match(result.inner,/子说明/);assert.doesNotMatch(result.inner,/父说明|待定说明/);require('../public/xml-source').validateXml('<fn>'+result.inner+'</fn>');
  assert.match(profiling.compile('<val><prop action="exclude" att="product" val="tbd"/></val>').summary,/排除产品标记为“待定（tbd）”/);
  assert.ok(scope.analyze(note('<ph product="tbd">BX-70</ph>：不能误作通用。'),'BX-70',{profile}).unresolved.length);
});

test('only and unsupported clauses are scoped, while ambiguous model prose requires review',()=>{
  assert.equal(scope.analyze(note('目前仅BX-7支持该设置。'),'BX-70').inner,'');
  const value=scope.analyze(note('共同影响。BX-70不支持2。'),'BX-7');assert.equal(value.inner,'共同影响。');
  assert.ok(scope.analyze(note('请根据BX-70的实际行为核对。'),'BX-7',{knownModels:['BX-70']}).unresolved.length);
  assert.equal(scope.analyze(note('HTTP：共同说明。'),'BX-7').scoped,0);
});

test('balanced Oxygen insertion spans and conditional model-label fragments remain valid',()=>{
  const original=note('<?oxy_insert_start author="A"?><div>BX-70：特例。</div><?oxy_insert_end?><div>BX-7<ph product="tbd">/BX-70</ph>：保留。</div>');
  const profile=profiling.compile('<val><prop action="exclude" att="product" val="tbd"/></val>');
  const result=scope.analyze(original,'BX-7',{profile});assert.deepEqual(result.unresolved,[]);assert.doesNotMatch(result.inner,/BX-70|oxy_insert/);assert.match(result.inner,/保留/);
  assert.ok(scope.analyze(note('<?oxy_insert_start author="A"?>BX-7：不完整。'),'BX-7').unresolved.length);
});

test('prefix projection preserves source, removes repeated calls and shares HTML/Markdown numbering',async()=>{
  buildMockDom();const source='<topic id="a"><title>T</title><body><fn id="shared">BX-70：OTHER。</fn><p>First<xref type="fn" href="#a/shared"/>Again<xref type="fn" href="#a/shared"/>Tail<fn>通用。<div>BX-7/BX-70：<b>KEEP</b>。</div><div>BX-70：OTHER。</div></fn></p></body></topic>';
  const files=new Map([['a.dita',{current:source}]]),map={title:'T',children:[{type:'file',path:'a.dita'}]};
  assert.equal(rules.project(files,null,'').files.get('a.dita').current,source);
  const disabled=rules.project(files,null,'BX-7');assert.equal(disabled.files.get('a.dita').current,source);assert.equal(disabled.prefixCandidates,2);
  const projected=rules.project(files,null,'BX-7',{prefixes:true}),data=publication.preparePublication({map,files:projected.files,model:'BX-7',ruleConfirmed:projected.confirmed,ruleExclusions:projected.excluded},core.collectPreviewPaths);
  assert.equal(data.notes.length,1);assert.equal(data.notes[0].number,1);
  for(const output of [await core.exportMapToHtml({map,files,publicationData:data}),await core.exportMapToMarkdown({map,files,publicationData:data})]){assert.match(output,/KEEP/);assert.doesNotMatch(output,/OTHER|BX-70/);}
  assert.equal(files.get('a.dita').current,source);
});

test('all HTTP source notes project for several models without leaking other model labels',()=>{
  const {collectDemoFiles}=require('../scripts/demo-workspace'),{decodeXmlBuffer}=require('../lib/document-files'),discovery=require('../public/model-discovery');
  const files=new Map([...collectDemoFiles(path.join(__dirname,'../examples/http_httpsusermanual'),'http_httpsusermanual.ditamap')].filter(([p])=>p.endsWith('.dita')).map(([p,b])=>[p,{current:decodeXmlBuffer(b)}]));
  const originals=new Map([...files].map(([p,f])=>[p,f.current])),profile=profiling.compile('<val><prop action="exclude" att="product" val="tbd"/></val>'),knownModels=discovery.discover(files,profile).models;
  for(const model of ['ML307G','ML307N','MN319-A','ML307B','MR880A']){
    const result=rules.project(files,null,model,{prefixes:true,profile,knownModels});assert.deepEqual(result.issues,[]);assert.equal(result.prefixApplied,29);
    for(const [p,f]of result.files)for(const n of notes.listFootnotes(f.current,p))for(const other of knownModels.filter(m=>m!==model)){
      const escaped=other.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');assert.doesNotMatch(n.text,new RegExp('(^|[^A-Za-z0-9_-])'+escaped+'(?=$|[^A-Za-z0-9_-])'));
    }
  }
  for(const [p,f]of files)assert.equal(f.current,originals.get(p));
});
