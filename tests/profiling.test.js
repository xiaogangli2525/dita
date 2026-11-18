'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { compile } = require('../public/profiling-core');
const publication = require('../public/publication-core');
const resolver = require('../public/publication-resolver');
const { createManualService } = require('../public/manual-service');
const core = require('../public/app-core');
const { buildMockDom } = require('./visual-harness');
const { createMapReader } = require('../lib/map-reader');
const { parseXml } = require('../lib/xml-tree');
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
test('DITAVAL merges matching condition group names before filtering each Map branch', () => {
  const profile = compile('<val><prop att="product" val="A" action="exclude"/></val>');
  const source = '<map>' +
    '<topicref href="repeated.dita" product="series(A) series(B)"/>' +
    '<topicref href="implicit.dita" product="A product(B)"/>' +
    '<topicref href="empty.dita" product="series() B"/>' +
    '<topicref href="excluded.dita" product="series(A) region(B)"/>' +
    '<topicref href="all-excluded.dita" product="series(A) series(A)"/>' +
    '</map>';
  assert.equal(profile.filterSource(source), source.replace(/<topicref href="(?:all-)?excluded\.dita"[^>]+\/>/g, ''));
  for (const product of ['series(A', 'series(other(A))', 'series(A)region(B)']) {
    assert.throws(() => profile.keep(node({ product })), /分组语法无效/);
  }
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

test('Map model filtering evaluates each reference lineage before ordering and deduplicating chapters', async () => {
  buildMockDom();
  const source = '<bookmap><booktitle><mainbooktitle>Guide</mainbooktitle></booktitle>' +
    '<part product="series(A1)"><chapter href="shared.dita" navtitle="For A"/><chapter href="contradiction.dita" product="B2"/></part>' +
    '<chapter href="common.dita"/><part scope="external" product="B2"><chapter scope="local" href="external-child.dita"/>' +
    '<chapter scope="local" href="shared.dita" navtitle="For B"/></part><chapter href="pending.dita" product="tbd"/></bookmap>';
  const map = { ...createMapReader().describe(parseXml(source).root, 'main.ditamap'), source };
  const files = new Map([
    ['shared.dita', { current: '<topic id="s"><body><p>SHARED_ONCE<fn product="series(A1) series(B2)">GROUP_NOTE</fn></p></body></topic>' }],
    ['common.dita', { current: '<topic id="c"><body><p>COMMON<xref href="shared.dita#s">See shared</xref></p></body></topic>' }],
    ['external-child.dita', { current: '<topic id="e"><body><p>B_ONLY</p></body></topic>' }],
    ['pending.dita', { current: '<topic id="p"><body><p>PENDING</p></body></topic>' }]
  ]);
  for (const [model, paths, title] of [['A1', ['shared.dita', 'common.dita'], 'For A'], ['B2', ['common.dita', 'external-child.dita', 'shared.dita'], 'For B']]) {
    const publicationData = publication.preparePublication({ map, files, model });
    assert.deepEqual(publicationData.entries.map(entry => entry.path), paths);
    assert.equal(publicationData.entries.find(entry => entry.path === 'shared.dita').title, title);
    assert.ok(publicationData.report.filteredMapBranches >= 2);
    assert.equal(publicationData.notes.length, 1);
    for (const render of [core.exportMapToHtml, core.exportMapToMarkdown]) {
      const output = await render({ map, files, model, publicationData });
      assert.equal(output.split('SHARED_ONCE').length, 2);
      assert.match(output, new RegExp(title));
      assert.match(output, /GROUP_NOTE/);
      assert.doesNotMatch(output, /PENDING|series\(|contradiction/);
      assert.equal(output.includes('B_ONLY'), model === 'B2');
    }
  }
  assert.throws(() => publication.preparePublication({ map, files }), /无法读取：contradiction\.dita/);
  assert.equal(map.source, source);
  assert.match(files.get('shared.dita').current, /series\(A1\) series\(B2\)/);
});

test('a DITAVAL exclusion of the selected product applies even when its group contains another model', () => {
  const source = '<map><topicref href="base.dita"/><topicref href="group.dita" product="series(A1 B2)"/></map>';
  const map = { ...createMapReader().describe(parseXml(source).root, 'main.ditamap'), source };
  const current = '<topic id="t"><body><p>body<fn id="note" product="series(A1 B2)">NOTE</fn>' +
    '<xref type="fn" href="#t/note" product="series(A1 B2)"/></p></body></topic>';
  const files = new Map([['base.dita', { current }], ['group.dita', { current }]]);
  const profile = compile('<val><prop att="product" val="A1" action="exclude"/></val>');
  const a = publication.preparePublication({ map, files, model: 'A1', profile });
  assert.deepEqual(a.entries.map(entry => entry.path), ['base.dita']);
  assert.equal(a.notes.length, 0);
  assert.doesNotMatch(a.files.get('base.dita').current, /type="fn"|NOTE/);
  const b = publication.preparePublication({ map, files, model: 'B2', profile });
  assert.deepEqual(b.entries.map(entry => entry.path), ['base.dita', 'group.dita']);
  assert.equal(b.notes.length, 2);
  assert.match(b.files.get('base.dita').current, /type="fn"/);
});

test('a delivery snapshot can show other model choices before resolving a missing chapter', async () => {
  const path = 'main.ditamap', topic = '<topic id="t"><body><p>Ready</p></body></topic>';
  const source = '<map><topicref href="a.dita" product="series(A1)"/><topicref href="missing.dita" product="series(B2)"/></map>';
  const reads = [];
  const service = createManualService({ state: { activePath: path, root: 'docs', currentBranch: 'main', filesMap: new Map() },
    api: { token: 'workspace', error: async response => await response.text(), async request(url, options) {
      if (url === '/api/map/resolve') return Response.json(createMapReader().describe(parseXml(JSON.parse(options.body).content).root, path));
      const file = new URL(url, 'http://local').searchParams.get('path');
      reads.push(file);
      return file === 'missing.dita' ? new Response('missing', { status: 404 }) : new Response(file === path ? source : topic);
    } } });
  const snapshot = await service.capture(path, { deferMissingTopics: true });
  assert.deepEqual(service.listModels(snapshot), ['A1', 'B2']);
  assert.deepEqual(service.prepare(snapshot, 'A1').entries.map(entry => entry.path), ['a.dita']);
  assert.throws(() => service.prepare(snapshot, 'B2'), /无法读取：missing\.dita/);
  assert.throws(() => service.prepare(snapshot), /无法读取：missing\.dita/);
  reads.length = 0;
  await service.capture(path, { model: 'A1' });
  assert.deepEqual(reads, [path, 'a.dita']);
});
