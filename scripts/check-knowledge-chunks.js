'use strict';
const fs = require('node:fs'), path = require('node:path');
const { bookFromPath, flatten } = require('../lib/knowledge-book');
const semantic = require('../lib/knowledge-semantic'), data = require('../public/knowledge/knowledge-semantic');
const { createSearchEngine } = require('../public/knowledge/knowledge-search');
async function main() {
  const args = process.argv.slice(2), compact = args.at(-1) === '--compare-int8';
  if (compact) args.pop();
  const [input, suite, destination] = args;
  const cases = require('../tests/fixtures/knowledge-chunk-cases.json')[suite];
  if (!input || !cases) throw Error('用法：node scripts/check-knowledge-chunks.js <知识库ZIP/HTML/JSON> <http|mr380r> [报告.json] [--compare-int8]');
  const book = bookFromPath(input, { structured: true }), records = flatten(book), engine = createSearchEngine(), lexicalIndex = engine.build(records);
  const next = book.semantic?.schema === 1 && book.semantic.profile?.id === data.PROFILE.id ? book.semantic : await semantic.build(records);
  data.validate(records, next);
  const comparisons = compact ? [['float32', next], ['int8', data.compactIndex(records, next)]] :
    [['legacy', await semantic.build(records, () => {}, { legacy: true })], ['structure', next]];
  const results = [];
  for (const item of cases) {
    const lexical = engine.search(records, lexicalIndex, item.query, '', 50), value = { ...item };
    for (const [name, index] of comparisons) {
      value[name] = {};
      for (const mode of ['semantic', 'hybrid']) {
        const hits = semantic.requiresLexical(item.query) ? lexical.slice(0, 3) : await semantic.search(records, index, item.query, lexical, { limit: 3, semanticOnly: mode === 'semantic' });
        const titles = hits.map(hit => records[hit.position].title);
        value[name][mode] = { top: titles, top1: item.expected ? titles[0] === item.expected : !titles.length, top3: item.expected ? titles.includes(item.expected) : !titles.length };
      }
    }
    results.push(value);
  }
  const summary = {};
  for (const [name] of comparisons) for (const mode of ['semantic', 'hybrid']) summary[name + '-' + mode] = {
    top1: results.filter(item => item[name][mode].top1).length, top3: results.filter(item => item[name][mode].top3).length, total: results.length,
    negativeFalsePositives: results.filter(item => !item.expected && item[name][mode].top.length).length
  };
  const report = { model: book.model, sdkVersion: book.sdkVersion, suite, chapterCount: records.length, structuredChapters: records.filter(record => record.structure).length,
    ...(compact ? { vectorBytes: Object.fromEntries(comparisons.map(([name, index]) => [name, atob(index.vectors).length])) } : { legacyChunks: comparisons[0][1].chunks.length }),
    structuredChunks: next.chunks.length, maxTokens: Math.max(...next.chunks.map(chunk => chunk.tokenCount)),
    splitChunks: next.chunks.filter(chunk => chunk.split).length, unitKinds: [...new Set(next.chunks.map(chunk => chunk.kind))], summary, results };
  if (destination) fs.writeFileSync(path.resolve(destination), JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ ...report, results: report.results.filter(item => !item[comparisons[1][0]].hybrid.top1) }, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
