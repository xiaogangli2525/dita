'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { execFileSync } = require('node:child_process'), iconv = require('iconv-lite');
const engine = require('../public/manual-domain'), domain = require('../public/manual-core');
const publication = require('../public/publication-core'), xml = require('../public/xml-source'), resolver = require('../public/publication-resolver');
const { collectDemoFiles } = require('../scripts/demo-workspace');

test('manual domain prepares and indexes notes in a clean Node process without editor, DOM or workspace services', () => {
  const result = execFileSync(process.execPath, ['-e', `
    const domain = require('./public/manual-domain');
    const snapshot = {map:{children:[{type:'file',path:'a.dita'}]},project:{models:['A1','B2']},
      files:new Map([['a.dita',{current:'<topic><body><p><fn product="A1">A note</fn><fn product="B2">B note</fn></p></body></topic>'}]])};
    const prepared = domain.prepare(snapshot, 'A1'), notes = domain.listNotes(snapshot, 'A1');
    if (Object.keys(require.cache).some(p => /(?:app-core|delivery-core|manual-service|application)\\.js$/.test(p))) throw Error('UI/IO dependency loaded');
    console.log(JSON.stringify({included:prepared.report.included,text:notes.notes[0].text,models:domain.listModels(snapshot)}));
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), { included: 1, text: 'A note', models: ['A1', 'B2'] });
});

test('shared publication membership preserves order, deduplicates files and excludes resource-only/non-topic entries', () => {
  const nodes = [{ type: 'container', children: [
    { type: 'file', path: 'a.DITA', title: 'First' }, { type: 'file', path: 'shared.dita', processingRole: 'resource-only' },
    { type: 'file', path: 'logo.svg' }, { type: 'file', path: 'b.xml' }, { type: 'file', path: 'a.DITA', title: 'Repeated' }
  ] }];
  assert.deepEqual(domain.collectPreviewPaths(nodes), [{ path: 'a.DITA', title: 'First' }, { path: 'b.xml', title: 'b.xml' }]);
  const files = new Map([['a.DITA', { current: '<topic><body><p><fn>FIRST</fn></p></body></topic>' }], ['b.xml', { current: '<topic><body><p><fn>SECOND</fn></p></body></topic>' }]]);
  const data = publication.preparePublication({ map: { children: nodes }, files });
  assert.deepEqual(data.notes.map(note => note.number), [1, 2]);
  assert.deepEqual([...data.files.keys()], ['a.DITA', 'b.xml']);
});

test('real HTTP snapshots can be prepared headlessly for several models without changing any source', () => {
  const corpus = collectDemoFiles(path.join(__dirname, '../examples/http_httpsusermanual'), 'http_httpsusermanual.ditamap');
  const decode = bytes => iconv.decode(bytes, bytes.toString('ascii', 0, 200).match(/encoding\s*=\s*["']([^"']+)/i)?.[1] || 'utf8');
  const source = decode(corpus.get('http_httpsusermanual.ditamap')), children = [];
  resolver.walk(xml.inspectSource(source), node => {
    if (node.attrs.href && /\.(dita|xml)$/i.test(node.attrs.href)) children.push({ type: 'file', path: node.attrs.href });
  });
  const files = new Map([...corpus].filter(([name]) => /\.(dita|xml)$/i.test(name)).map(([name, bytes]) => [name, Object.freeze({ path: name, current: decode(bytes) })]));
  const before = [...files].map(([name, file]) => [name, file.current]);
  const snapshot = { path: 'http_httpsusermanual.ditamap', map: { source, children }, files, project: { models: [] },
    filter: { path: 'filters/filter_tbd.ditaval', current: decode(corpus.get('filters/filter_tbd.ditaval')) } };
  snapshot.project.models = engine.discoverModels(snapshot).models;
  assert.equal(domain.collectPreviewPaths(children).length, 25);
  for (const model of ['ML307G', 'ML307N', 'MN319-A']) {
    const data = engine.prepare(snapshot, model, true, { prefixes: true });
    const labels = data.notes.flatMap(note => note.xml.match(/\b(?:ML|MN|MR)\d+[A-Z0-9]*(?:-[A-Z0-9]+)*\b/g) || []);
    assert.ok(labels.length); assert.ok(labels.every(name => name === model), model + ': ' + labels.join(','));
    assert.ok(data.report.prefixApplied > 0);
  }
  assert.deepEqual([...files].map(([name, file]) => [name, file.current]), before);
});

test('delivery diagnostics include only model-visible notes, including sources of shared references', () => {
  const files = new Map([
    ['a.dita', { current: '<topic><body><p><fn>A1：当前范围。B2：另一范围。</fn><xref type="fn" href="shared.dita#s/used"/><xref product="B2" type="fn" href="shared.dita#s/other"/><fn audience="internal">请按B2的实际情况执行。</fn></p></body></topic>' }],
    ['shared.dita', { current: '<topic id="s"><body><p><fn id="used">请按B2的实际情况核对。</fn><fn id="other">请按B2的实际情况测试。</fn></p></body></topic>' }]
  ]);
  const snapshot = { map: { children: [{ type: 'file', path: 'a.dita' }] }, files, project: { models: ['A1', 'B2'] },
    filter: { current: '<val><prop att="audience" val="internal" action="exclude"/></val>' } };
  const review = engine.prepare(snapshot, 'A1').noteReview;
  assert.deepEqual(review.map(({ path, kind, note }) => [path, kind, note.text]), [
    ['a.dita', 'prefix', 'A1：当前范围。B2：另一范围。'],
    ['shared.dita', 'model-scope', '请按B2的实际情况核对。']
  ]);
  assert.throws(() => engine.prepare(snapshot, 'A1', true, { prefixes: true }),
    error => error.issues.length === 1 && error.issues[0].note.before.includes('id="used"'));
});
