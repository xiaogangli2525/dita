'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { collectDemoFiles } = require('../scripts/demo-workspace');
test('isolated demonstration copies a manual closure with exact bytes and skips unrelated libraries', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-demo-closure-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  fs.mkdirSync(path.join(dir, 'shared')); fs.mkdirSync(path.join(dir, 'filters'));
  fs.writeFileSync(path.join(dir, 'main.ditamap'), '<map><topicref href="a.dita"/></map>');
  const topic = Buffer.from('<topic><body><p conref="shared/n.dita#n/p"/><image href="logo.png"/><xref scope="external" href="https://example.invalid"/></body></topic>\r\n');
  fs.writeFileSync(path.join(dir, 'a.dita'), topic);
  fs.writeFileSync(path.join(dir, 'shared/n.dita'), '<topic><body><p conref="../a.dita#a/p"/></body></topic>');
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0,255,13,10]));
  fs.writeFileSync(path.join(dir, 'unrelated.dita'), '<topic/>');
  fs.writeFileSync(path.join(dir, 'filters/release.ditaval'), '<val/>');
  const files = collectDemoFiles(dir, 'main.ditamap');
  assert.equal(files.size, 5); assert.deepEqual(files.get('a.dita'), topic);
  assert.deepEqual(files.get('logo.png'), Buffer.from([0,255,13,10])); assert.ok(!files.has('unrelated.dita'));
});
test('demonstration refuses traversal and symbolic references outside the supplied library', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-demo-boundary-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  fs.mkdirSync(path.join(dir, 'docs')); fs.writeFileSync(path.join(dir, 'outside.dita'), '<topic/>');
  const map = path.join(dir, 'docs/main.ditamap'); fs.writeFileSync(map, '<map><topicref href="../outside.dita"/></map>');
  assert.throws(() => collectDemoFiles(path.dirname(map), 'main.ditamap'), /超出工作区/);
  fs.symlinkSync(path.join(dir, 'outside.dita'), path.join(dir, 'docs/link.dita'));
  fs.writeFileSync(map, '<map><topicref href="link.dita"/></map>');
  assert.throws(() => collectDemoFiles(path.dirname(map), 'main.ditamap'), /超出文档库/);
});
