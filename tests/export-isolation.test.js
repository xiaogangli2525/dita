'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildMockDom } = require('./visual-harness'), core = require('../public/app-core');
const input = name => ({map:{title:name,children:[{type:'file',path:name+'/topic.dita'}]},files:new Map([[name+'/topic.dita',{current:`<topic id="${name}"><title>${name}</title><body><p>${name}<image href="pic.png"/><fn>${name}_NOTE</fn></p></body></topic>`}]])});
test('overlapping exports isolate image bytes, paths and note definitions in both formats',async()=>{
 buildMockDom();
 for(const format of ['Html','Markdown']){
  let release,reached;const gate=new Promise(r=>release=r),arrived=new Promise(r=>reached=r);
  const a=core['exportMapTo'+format]({...input('A'),loadImageBytes:async path=>{assert.equal(path,'A/pic.png');reached();await gate;return 'data:image/png;base64,QQ==';}});
  await arrived;
  const b=await core['exportMapTo'+format]({...input('B'),loadImageBytes:async path=>{assert.equal(path,'B/pic.png');return 'data:image/png;base64,Qg==';}});
  release();const result=await a;
  assert.match(result,/QQ==/);assert.doesNotMatch(result,/Qg==|B_NOTE/);assert.match(b,/Qg==/);assert.doesNotMatch(b,/QQ==|A_NOTE/);
 }
});
test('direct export callers cannot receive successful output after a requested image fails or is empty',async()=>{
 buildMockDom();
 for(const format of ['Html','Markdown'])for(const loader of [async()=>{throw Error('unavailable');},async()=>null,async()=>'',async()=>'/unembedded.png']){
  await assert.rejects(core['exportMapTo'+format]({...input('A'),loadImageBytes:loader}),e=>e.issues?.length===1&&e.issues[0].path==='A/pic.png');
 }
 const error=Object.assign(new Error('cancelled'),{name:'AbortError'});
 await assert.rejects(core.exportMapToHtml({...input('A'),loadImageBytes:async()=>{throw error;}}),e=>e===error);
});
test('nested Author rendering cannot change the outer topic asset base or footnote counter',()=>{
 const {document}=buildMockDom(),create=document.createElement.bind(document);let nested,entered=false;
 const source='<topic><title>T</title><body><p>One<fn>First</fn><image href="pic.png"/>Two<fn>Second</fn></p></body></topic>';
 document.createElement=tag=>{if(tag==='sup'&&!entered){entered=true;nested=core.createAuthorTopic(source,document,false,'B/topic.dita');}return create(tag);};
 const outer=core.createAuthorTopic(source,document,false,'A/topic.dita');
 for(const surface of [outer,nested])assert.deepEqual(surface.querySelectorAll('sup').map(n=>n.textContent),['[1]','[2]']);
 assert.match(outer.querySelector('img').src,/A%2Fpic.png/);assert.match(nested.querySelector('img').src,/B%2Fpic.png/);
});
