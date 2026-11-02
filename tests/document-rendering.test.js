'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createTestApp,buildMockDom} = require('./visual-harness');
const core = require('../public/app-core');
const presentation = require('../public/document-presentation');
test('all preformatted DITA blocks preserve line breaks, inline XML and exact source through Author',()=>{
 for(const name of presentation.preformatted){
  const source=`<?xml version='1.0' encoding='GBK'?>\r\n<topic id='t'><title>T</title><body><${name} id='response' outputclass='sample'>AT+<cmdname id='command'>TEST</cmdname>\r\n  +RESULT: <varname>&lt;value></varname>\r\n\tOK</${name}><p>Keep <filepath id='path'>/etc/config</filepath></p></body></topic>`;
  const app=createTestApp(source);app.updateVisualFromXml(source);const pre=app.dom.visualEditor.querySelector('pre');
  assert.equal(pre.getAttribute('data-dita-source'),name);assert.equal(pre.textContent,'AT+TEST\r\n  +RESULT: <value>\r\n\tOK');
  app.visualToXml();assert.equal(app.state.filesMap.get('topic.dita').current,source);
  pre.querySelectorAll('span').find(n=>n.getAttribute('id')==='command').textContent='UPDATED';app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current,source.replace('>TEST<','>UPDATED<'));
 }
});
test('note labels and tones are presentation-only, including custom titles and all standard types',()=>{
 for(const [type,label]of Object.entries(presentation.noteTypes)){
  const source=`<topic id='t'><title>T</title><body><note type='${type}' othertype='兼容性' id='n' product='M100'><p>Keep <b>rich</b> text.</p></note></body></topic>`;
  const app=createTestApp(source);app.updateVisualFromXml(source);const note=app.dom.visualEditor.querySelectorAll('div').find(n=>n.getAttribute('data-dita-source')==='note');
  assert.equal(note.getAttribute('data-dita-note-label'),type==='other'?'兼容性':label);app.visualToXml();assert.equal(app.state.filesMap.get('topic.dita').current,source);
 }
});
test('delivery preserves response blocks, CALS column proportions and safe typed-note labels',async()=>{
 buildMockDom();const source='<topic id="t"><title>HTTP</title><body><table><tgroup cols="2"><colspec colname="a" colwidth="3*"/><colspec colname="b" colwidth="7*"/><tbody><row outputclass="has_bgc"><entry>Syntax</entry><entry>Response<msgblock id="response">+HTTP: 0,0\n  OK</msgblock></entry></row></tbody></tgroup></table><note type="other" othertype="&lt;兼容性&gt;"><p>Note body</p></note></body></topic>';
 const input={map:{title:'HTTP',children:[{type:'file',path:'a.dita'}]},files:new Map([['a.dita',{current:source}]])};const html=await core.exportMapToHtml(input);
 assert.match(html,/<colgroup><col style="width:30%"\/><col style="width:70%"\/><\/colgroup>/);
 assert.match(html,/<pre[^>]*>\+HTTP: 0,0\n {2}OK<\/pre>/);assert.match(html,/&lt;兼容性&gt;：/);assert.doesNotMatch(html,/<兼容性>/);
 assert.match(html,/data-dita-outputclass="has_bgc"/);assert.match(html,/class="dita-note"/);
 assert.equal((html.match(/class="dita-note"/g)||[]).length,1);assert.doesNotMatch(html,/<span class="note-icon">|class="dita-note dita-note-/);
 const md=await core.exportMapToMarkdown({...input,files:new Map([['a.dita',{current:'<topic id="t"><title>T</title><body><msgblock>+HTTP: 0,0\n  OK</msgblock></body></topic>'}]])});
 assert.match(md,/```\n\+HTTP: 0,0\n {2}OK\n```/);
});
test('inline emphasis, parameter lists and script markers retain semantics and exact XML',async()=>{
 const source='<topic id="t"><title>T</title><body><p><b>Bold</b><i>Italic</i><u>Under</u> H<sub>2</sub> x<sup>2</sup><q>Quote</q></p><parml><plentry><pt><b>Parameter</b></pt><pd>Description <i>emphasis</i></pd></plentry></parml><dl><dlentry><dt><b>Term</b></dt><dd>Meaning</dd></dlentry></dl></body></topic>';
 const app=createTestApp(source);app.updateVisualFromXml(source);
 assert.equal(app.dom.visualEditor.querySelector('sub').textContent,'2');assert.equal(app.dom.visualEditor.querySelector('sup').textContent,'2');
 const terms=app.dom.visualEditor.querySelectorAll('dt');assert.equal(terms.length,2);assert.ok(terms.every(n=>n.querySelector('span')));
 app.visualToXml();assert.equal(app.state.filesMap.get('topic.dita').current,source);
 const html=await core.exportMapToHtml({map:{title:'T',children:[{type:'file',path:'a.dita'}]},files:new Map([['a.dita',{current:source}]])});
 assert.match(html,/<strong>Bold<\/strong>/);assert.match(html,/<em>Italic<\/em>/);assert.match(html,/<sub>2<\/sub>/);assert.match(html,/<dt><strong>Parameter<\/strong><\/dt>/);
 const md=await core.exportMapToMarkdown({map:{title:'T',children:[{type:'file',path:'a.dita'}]},files:new Map([['a.dita',{current:source}]])});assert.match(md,/\*\*Parameter\*\*/);assert.match(md,/Description \*emphasis\*/);
});
