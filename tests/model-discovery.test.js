'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const discovery = require('../public/model-discovery'), publication = require('../public/publication-core'), manual = require('../public/manual-core');
const {compile} = require('../public/profiling-core');
const files = source => new Map([['a.dita', {current:source}]]);
test('model discovery reads actual HTTP series and separates pending rows without modifying source', () => {
  const source = fs.readFileSync(path.join(__dirname, '../examples/http_httpsusermanual/topics/g_applicable_model.dita'), 'utf8');
  const input = files(source), result = discovery.discover(input);
  assert.equal(result.models.length, 26); assert.ok(result.models.includes('ML307B')); assert.ok(result.models.includes('MN319-A'));
  assert.deepEqual(result.pending, ['M5310-E','MN327','MN328','MR380M']); assert.deepEqual(result.ignored,['tbd']);
  assert.ok(!result.models.includes('tbd')); assert.ok(!result.models.includes('ML307Y-DU'));
  assert.equal(input.get('a.dita').current, source); assert.deepEqual(publication.listModels(input), result.models);
});
test('workflow markers, unrelated tables and natural-language footnotes are not model declarations', () => {
  const input = files('<topic><body><p product="M100 TBD">Text</p><p product="M200">Public</p><fn>Only ML307X supports this. MN319 does not support it.</fn><table><tgroup><thead><row><entry>参数</entry><entry>示例</entry></row></thead><tbody><row><entry>ML307Z</entry><entry>Example</entry></row></tbody></tgroup></table></body></topic>');
  assert.deepEqual(discovery.discover(input).models,['M100','M200']);
  assert.deepEqual(manual.checkModels(['tbd','TBD','WRONG'],{models:['M200']}),['WRONG']);
  assert.equal(discovery.isModel('MR880A M.2'),false);
});
test('DITAVAL visibility and conrefs apply to discovered declarations', () => {
  const input = files('<topic id="a"><body><p conref="b.dita#b/p"/><p audience="internal" product="PRIVATE"/><p product="M100"/></body></topic>');
  input.set('b.dita',{current:'<topic id="b"><body><p id="p" product="M300">Common source</p></body></topic>'});
  const profile = compile('<val><prop att="audience" val="internal" action="exclude"/></val>');
  assert.deepEqual(publication.listModels(input, profile),['M100','M300']);
});
test('one declared series remains one candidate rather than guessing slash-separated variants',()=>{
 const source='<topic><body><table><tgroup><thead><row><entry>模组系列</entry><entry>模组子型号</entry></row></thead><tbody><row><entry>ML353A</entry><entry>ML353A-A/ML353A-B</entry></row></tbody></tgroup></table></body></topic>';
 assert.deepEqual(discovery.discover(files(source)).models,['ML353A']);
});
