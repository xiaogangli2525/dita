'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createApiHandler } = require('../lib/api-router');
const files = require('../lib/document-files'), xml = require('../lib/xml-tree');
const { createMapReader } = require('../lib/map-reader');

test('successful PUT and Save As acknowledge committed content without a fallible post-write read', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-save-ack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = '<topic><title>Before</title></topic>', content = '<topic><title>After</title></topic>';
  let committed = false, reads = 0;
  const handle = createApiHandler({
    workspace: { root, token: 'test' }, git: {}, port: 1234,
    documents: {
      checkedResolve: (name, options) => files.resolveWorkspacePath(root, name, options),
      relativePath: file => path.relative(root, file), isDitaLike: file => /\.(dita|ditamap|xml)$/.test(file),
      readXmlFile: async file => { reads++; if (committed) throw Error('Simulated post-commit read failure'); return files.readXmlFile(file); },
      writeXmlFile: async (...args) => { await files.writeXmlFile(...args); committed = true; }
    },
    maps: { ...xml, mapNodeToTree: createMapReader().children }
  });
  for (const [method, overwrite] of [['PUT', true], ['POST', true], ['POST', false]]) {
    const name = method === 'POST' && !overwrite ? 'new.dita' : 'existing.dita';
    await fs.writeFile(path.join(root, 'existing.dita'), original);
    committed = false; reads = 0;
    const body = { path: name, content, ...(overwrite ? { overwrite: true, expectedContent: original } : {}) };
    const req = { method, headers: { host: 'localhost:1234', 'x-workspace-token': 'test' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
    let status, result;
    await handle(req, { writeHead: value => { status = value; }, end: value => { result = JSON.parse(value); } }, '/api/file', new URLSearchParams());
    assert.equal(status, method === 'PUT' ? 200 : 201);
    assert.equal(result.saved, true); assert.equal(result.content, content);
    assert.equal(reads, overwrite ? 1 : 0);
    assert.equal(await files.readXmlFile(path.join(root, name)), content);
  }
});
