'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events'), { Readable } = require('node:stream');
const { createAiHandler } = require('../lib/ai-routes');
const xml = '<topic><title>T</title><body><p>原文</p></body></topic>';
function request(body) { const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]); req.headers = {}; req.method = 'POST'; return req; }
function response() { const res = new EventEmitter(); res.setHeader = () => {}; res.writeHead = status => { res.status = status; }; res.end = body => { res.body = body; res.writableEnded = true; }; return res; }
const input = { source: xml, start: xml.indexOf('原文'), end: xml.indexOf('原文') + 2, instruction: '润色' };
test('AI response after a workspace switch is rejected before returning a proposal', async () => {
  const workspace = { token: 'old' }; let resolve, started;
  const ready = new Promise(r => { started = r; });
  const handler = createAiHandler({ workspace, provider: { generate: () => { started(); return new Promise(r => { resolve = r; }); } } });
  const res = response(), pending = handler(request(input), res, '/api/ai/propose');
  await ready; workspace.token = 'new'; resolve({ summary: '', questions: [], edits: [] });
  await assert.rejects(pending, error => error.status === 409); assert.equal(res.body, undefined);
});
test('closing the HTTP response aborts the provider request; malformed input never calls it', async () => {
  let signal, started, called = 0; const ready = new Promise(r => { started = r; });
  const handler = createAiHandler({ workspace: { token: 'same' }, provider: { generate: (_input, value) => { called++; signal = value; started(); return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(Error('cancel')), { once: true })); } } });
  await assert.rejects(handler(request('{bad'), response(), '/api/ai/propose'), error => error.status === 400); assert.equal(called, 0);
  const res = response(), pending = handler(request(input), res, '/api/ai/propose'); await ready; res.emit('close');
  await assert.rejects(pending, /cancel/); assert.equal(signal.aborted, true); assert.equal(res.listenerCount('close'), 0);
});
