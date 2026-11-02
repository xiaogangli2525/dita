'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createAtomicWriter} = require('../lib/document-files');
function mockIO(failAt, code = 'EPERM') {
  const calls = [], error = Object.assign(new Error('Original write failure'), {code});
  const op = name => async () => { calls.push(name); if (failAt === name) throw error; };
  const handle = {writeFile:op('write'), sync:op('sync'), close:op('close')};
  const io = {stat:async()=>({mode:0o644}), open:async()=>{await op('open')();return handle;}, link:op('link'), rename:op('rename'), rm:op('rm')};
  return {io,calls,error};
}
test('denied temporary-file creation reports the target and stage without removing unowned files',async()=>{
 const {io,calls,error}=mockIO('open');
 await assert.rejects(createAtomicWriter(io)('/repo/.dita-project.json',Buffer.from('new'),true),e=>e.code==='EPERM'&&e.status===403&&e.cause===error&&e.message.includes('创建临时文件')&&e.message.includes('.dita-project.json'));
 assert.deepEqual(calls,['open']);
});
test('failed replacement preserves its original error even if temporary cleanup also fails',async()=>{
 const {io,calls,error}=mockIO('rename');io.rm=async()=>{calls.push('rm');throw Object.assign(new Error('cleanup'),{code:'EACCES'});};
 const writer=createAtomicWriter(io);
 await assert.rejects(writer('/repo/a.dita',Buffer.from('new'),false),e=>e.cause===error&&e.message.includes('提交目标文件'));
 assert.deepEqual(calls,['open','write','sync','close','rename','rm']);
});
test('atomic create conflicts remain conflicts and successful replace needs no cleanup',async()=>{
 const a=mockIO('link','EEXIST');await assert.rejects(createAtomicWriter(a.io)('/repo/a.dita',Buffer.from('new'),true),e=>e.code==='EEXIST'&&e.status===409);assert.equal(a.calls.at(-1),'rm');
 const b=mockIO();await createAtomicWriter(b.io)('/repo/a.dita',Buffer.from('new'),false);assert.deepEqual(b.calls,['open','write','sync','close','rename']);
});
