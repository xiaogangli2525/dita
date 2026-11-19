'use strict';
// Execute the production classic Worker in an isolated thread for Node tests.
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const workerPath = require.resolve('../../public/knowledge/knowledge-publish-worker');
const context = vm.createContext({ console, performance, TextEncoder, TextDecoder, Blob, Headers, Response, URL, atob, btoa,
  AbortController, structuredClone, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    parentPort.postMessage({ type: 'test-request', url });
    if (workerData?.oversize && url === '/api/knowledge/publish') {
      const profile = require('../../public/knowledge/knowledge-semantic').PROFILE;
      return new Response(JSON.stringify({ type: 'estimate', profile, chunks: 12000, bytes: 64 * 1024 * 1024 }) + '\n');
    }
    if (workerData?.origin) return fetch(new URL(url, workerData.origin), options);
    throw Error('Unexpected request: ' + url);
  }, postMessage: value => parentPort.postMessage(value) });
context.self = context;
context.importScripts = (...names) => names.forEach(name => {
  const filename = path.resolve(path.dirname(workerPath), name);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
});
vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context, { filename: workerPath });
parentPort.on('message', data => context.onmessage({ data }));
