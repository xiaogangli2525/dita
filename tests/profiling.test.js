'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { compile } = require('../public/profiling-core');
const publication = require('../public/publication-core');
const resolver = require('../public/publication-resolver');
const { createManualService } = require('../public/manual-service');
const core = require('../public/app-core');
const { buildMockDom } = require('./visual-harness');
const val = '<val><prop att="product" val="tbd" action="exclude"/></val>';
const node = attrs => ({ attrs });
test('DITAVAL honors OR within values, AND across attributes, defaults and group precedence', () => {
  const profile = compile('<val><prop action="exclude"/><prop att="product" val="public" action="include"/><prop att="audience" val="customer" action="passthrough"/><prop att="product" val="database" action="include"/></val>');
  assert.equal(profile.keep(node({})), true);
  assert.equal(profile.keep(node({ product: '' })), true);
  assert.equal(profile.keep(node({ product: 'internal public', audience: 'customer' })), true);
  assert.equal(profile.keep(node({ product: 'public', audience: 'internal' })), false);
  assert.equal(profile.keep(node({ product: 'appserver(internal) database(sql)' })), false);
  assert.equal(profile.keep(node({ product: 'database(sql)' })), true);
  assert.equal(compile(val).keep(node({product:'tbd released'})), true);
  assert.equal(compile(val).keep(node({product:'tbd'})), false);
  assert.equal(compile(val).keep(node({otherprops:'applicability(common)'})), true);
});
test('invalid and unsupported DITAVALs stop explicitly instead of passing ignored rules', () => {
  for (const source of ['<topic/>', '<val><revprop action="flag"/></val>', '<val><prop att="product" action="flag"/></val>', '<val><prop att="rev" action="exclude"/></val>', '<val><prop val="x" action="exclude"/></val>', '<val><prop att="product" val="a b" action="exclude"/></val>', '<val><prop action="include"/><prop action="exclude"/></val>']) assert.throws(()=>compile(source));
});
test('a profile that excludes all published topics refuses an empty customer manual',()=>{
 const files=new Map([['hidden.dita',{current:'<topic id="h" product="tbd"><title>H</title></topic>'}]]);
 assert.throws(()=>publication.preparePublication({map:{children:[{type:'file',path:'hidden.dita'}]},files,profile:compile(val)},core.collectPreviewPaths),/排除了所有正文/);
});
test('profile publication removes ancestors and excluded note references while preserving source provenance', async () => {
  buildMockDom();
  const source = '<topic id="t"><title>Title</title><shortdesc>Summary</shortdesc><body><p>Visible<fn>FIRST_NOTE</fn></p><div product="tbd"><p>PRIVATE_TEXT<fn id="hidden">PRIVATE_NOTE</fn><xref type="fn" href="missing.dita#t/missing"/><image href="missing.png"/><p conref="missing.dita#t/p"/></p></div><p>Call<xref type="fn" href="#t/hidden"/>Remaining<fn>SECOND_NOTE</fn></p></body></topic>';
  const hidden = '<topic id="h" product="tbd"><title>HIDDEN_TOPIC</title><body><p>Hidden</p></body></topic>';
  const files = new Map([['a.dita',{current:source}],['hidden.dita',{current:hidden}]]);
  const map = {title:'Guide',children:[{type:'file',path:'a.dita'},{type:'file',path:'hidden.dita'}]};
  const data = publication.preparePublication({map,files,profile:compile(val)},core.collectPreviewPaths);
  const html = await core.exportMapToHtml({map,files,publicationData:data,loadImageBytes:()=>{throw Error('excluded image read');}});
  assert.doesNotMatch(html,/PRIVATE_TEXT|PRIVATE_NOTE|HIDDEN_TOPIC|missing\.png/);
  assert.match(html,/FIRST_NOTE/);assert.match(html,/SECOND_NOTE/);assert.equal(data.notes.length,2);
  assert.equal(data.notes[1].origin.start,source.indexOf('<fn>SECOND_NOTE'));
  assert.equal(data.calls.find(c=>c.number===2).site.start,source.indexOf('<fn>SECOND_NOTE'));
  assert.equal(files.get('a.dita').current,source);
  assert.deepEqual(resolver.dependencies(source,'a.dita',compile(val)),['a.dita']);
});
test('manual capture freezes DITAVAL buffers, filters Map references before loading and detects stale filter edits', async () => {
  const file={path:'filters/release.ditaval',current:val,disk:val}, topic='<topic id="t"><title>T</title><body><p product="tbd">PRIVATE</p><p>Public</p></body></topic>';
  const state={root:'docs',currentBranch:'main',activePath:'main.ditamap',filesMap:new Map([[file.path,file]])};
  const reads=[], source='<map><topicref href="missing.dita" product="tbd"/><topicref href="a.dita"/></map>';
  const a={state,ditaCore:core,api:{token:'w',error:async()=> 'missing',request:async(url,options)=>{
    reads.push(url);
    if(url==='/api/map/resolve'){assert.doesNotMatch(JSON.parse(options.body).content,/missing/);return {ok:true,json:async()=>({children:[{type:'file',path:'a.dita'}]})};}
    const path=new URL(url,'http://local').searchParams.get('path');return {ok:true,text:async()=>path==='main.ditamap'?source:topic};
  }}};
  const service=createManualService(a),snapshot=await service.capture('main.ditamap',{filterPath:file.path});
  assert.equal(snapshot.filter.current,val);assert.equal(service.current(snapshot),true);
  assert.doesNotMatch(service.prepare(snapshot).files.get('a.dita').current,/PRIVATE/);
  assert.equal(reads.some(path=>path.includes('missing.dita')),false);
  file.current='<val/>';assert.equal(service.current(snapshot),false);
  assert.deepEqual(service.saveCandidates(snapshot),[]);
  file.current=val.replace('</val>','<prop att="audience" val="internal" action="exclude"/></val>');
  file.dirty=true;assert.deepEqual(service.saveCandidates(snapshot),[],'captured dirty state does not follow later edits');
  const updated=await service.capture('main.ditamap',{filterPath:file.path});
  assert.deepEqual(service.saveCandidates(updated).map(f=>f.path),[file.path]);
});
