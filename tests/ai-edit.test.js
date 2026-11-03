'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../public/ai-edit-core');
const store = require('../public/document-store');
const source = '<?xml version="1.0" encoding="UTF-8"?>\r\n<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\r\n<topic id="http"><title>HTTP</title><body><p product="ML307R">发送 <b>请求</b> &amp; 检查返回值。<fn id="note">MN318: 保留。</fn></p><p>其他型号原文</p></body></topic>';
const scopeOf = (xml = source) => { const p = core.inspect(xml).find(n => n.kind === 'p'); return core.target(xml, p.start, p.end); };

test('AI text patches preserve source structure, conditions, references, entities outside edits and other models', () => {
  const scope = scopeOf(); assert.deepEqual(scope.conditions, ['product=ML307R']);
  const result = core.applyResult(scope, { summary: '表达更明确', questions: [], edits: [{ id: scope.parts[0].id, before: '发送 ', after: '发起 ' }] });
  assert.equal(result.content, source.replace('发送 ', '发起 ')); assert.equal(result.changes.length, 1);
  assert.ok(Object.isFrozen(scope.parts)); assert.ok(Object.isFrozen(scope.parts[0]));
});
test('AI subrange edits retain surrounding text and escape markup as literal text', () => {
  const start = source.indexOf('检查'), scope = core.target(source, start, start + 2);
  const result = core.applyResult(scope, { summary: '', questions: [], edits: [{ id: 't0', before: '检查', after: '<核对>&' }] });
  assert.equal(result.content, source.replace('检查', '&lt;核对&gt;&amp;'));
  assert.throws(() => core.target(source, source.indexOf('&amp;') + 1, source.indexOf('&amp;') + 3), /实体/);
});
test('AI refuses stale, repeated and malformed edits; valid partial work can accompany questions', () => {
  const scope = scopeOf(), edit = { id: 't0', before: scope.parts[0].text, after: '发起 ' };
  for (const result of [null, { summary: '', questions: [], edits: [{ ...edit, id: 't99' }] }, { summary: '', questions: [], edits: [edit, edit] }, { summary: '', questions: [], edits: [{ ...edit, before: '过期' }] }, { summary: '', questions: [1], edits: [] }]) assert.throws(() => core.applyResult(scope, result));
  assert.equal(core.applyResult(scope, { summary: '缺少正确值', questions: ['正确值是多少？'], edits: [] }).content, source);
  const partial = core.applyResult(scope, { summary: '先润色', questions: ['正确值是多少？'], edits: [edit] });
  assert.equal(partial.content, source.replace('发送 ', '发起 ')); assert.equal(partial.questions.length, 1);
});
test('AI refuses maps, reused content, revisions, oversized input and invalid XML output', () => {
  for (const xml of ['<map><title>x</title></map>', '<topic><title>x</title><body><p conref="a.dita#t/p">x</p></body></topic>', '<topic><title>x</title><body><p><?oxy_insert_start?>x<?oxy_insert_end?></p></body></topic>']) {
    const start = xml.indexOf('<p'); assert.throws(() => core.target(xml, start >= 0 ? start : 0, xml.length - 1));
  }
  assert.throws(() => core.inspect('x'.repeat(core.LIMITS.source + 1)), /过大/);
  const scope = scopeOf(); assert.throws(() => core.applyResult(scope, { summary: '', questions: [], edits: [{ id: 't0', before: scope.parts[0].text, after: '\0' }] }), /XML/);
  const xml = '<topic><title>T</title><body><codeblock><![CDATA[AT+HTTP]]></codeblock></body></topic>';
  const block = core.inspect(xml).find(n => n.kind === 'codeblock'), code = core.target(xml, block.start, block.end);
  assert.throws(() => core.applyResult(code, { summary: '', questions: [], edits: [{ id: 't0', before: 'AT+HTTP', after: ']]>' }] }), /CDATA/);
});
test('AI lookup exposes duplicate candidates for user selection and includes Chinese keywords', () => {
  const xml = '<topic><title>HTTP</title><body><p>请求超时</p><p>请求超时</p><p>MQTT 连接</p></body></topic>';
  const results = core.candidates(xml, '测试反馈请求超时描述不清楚'); assert.equal(results.length, 2); assert.notEqual(results[0].start, results[1].start);
});
test('AI proposal uses captured working buffer, supports undo and refuses newer edits or workspace changes', () => {
  const file = store.createDocument({ path: 'http.dita', content: source }), captured = store.snapshotDocument(file);
  const proposal = store.createProposal({ file: captured, workspaceToken: 'old', content: source.replace('发送', '发起'), instruction: '润色' }, () => {});
  store.editDocument(file, source.replace('HTTP', 'HTTP 新增'));
  assert.throws(() => store.applyProposal(proposal, { file, workspaceToken: 'old' }, () => {}, store.editDocument), /变化/);
  store.travelHistory(file, 'undo'); assert.throws(() => store.applyProposal(proposal, { file, workspaceToken: 'new' }, () => {}, store.editDocument), /变化/);
  store.applyProposal(proposal, { file, workspaceToken: 'old' }, () => {}, store.editDocument); assert.equal(file.disk, source);
  store.travelHistory(file, 'undo'); assert.equal(file.current, source);
});
test('chat-first document scope can revise multiple paragraphs while keeping per-fragment conditions and source bytes', () => {
  const scope = core.documentTarget(source, '发送请求');
  const selected = scope.parts.find(p => p.text === '发送 '), other = scope.parts.find(p => p.text === '其他型号原文');
  assert.deepEqual(selected.conditions, ['product=ML307R']);
  const updated = core.applyResult(scope, { summary: '', questions: [], edits: [{ id: selected.id, before: selected.text, after: '发起 ' }, { id: other.id, before: other.text, after: '其他型号说明' }] });
  assert.equal(updated.content, source.replace('发送 ', '发起 ').replace('其他型号原文','其他型号说明'));
});
test('document context is bounded, marks partial content and does not expose reused fragments as editable', () => {
  const xml = '<topic><title>T</title><body><p conref="other.dita#t/p">不可修改</p>' + '<p>普通说明</p>'.repeat(100) + '</body></topic>';
  const scope = core.documentTarget(xml, '普通说明'); assert.ok(scope.truncated); assert.ok(scope.parts.length <= core.LIMITS.edits);
  assert.ok(scope.text.length <= core.LIMITS.text); assert.doesNotMatch(scope.text, /不可修改/);
});
test('review highlights technical value, unit, model and command changes without treating them as verified facts', () => {
  const xml = '<topic><title>T</title><body><p>ML307R 支持 AT+HTTP，默认30秒。</p></body></topic>', scope = core.documentTarget(xml);
  const part = scope.parts.find(p=>p.text.includes('ML307R'));
  const result = core.applyResult(scope, { summary: '', questions: [], edits: [{id:part.id,before:part.text,after:'MN318 不支持 AT+HTTPS，默认60毫秒。'}] });
  assert.deepEqual(result.changes[0].reviewFlags, ['AT 命令变化','型号名称变化','数值或范围变化','单位变化','能力或约束措辞变化']);
});
test('document and selection context retain inline model conditions rather than flattening them to their paragraph', () => {
  const xml = '<topic><title>T</title><body><p>通用：<ph product="ML307R"><b audience="developer">30秒</b></ph></p></body></topic>';
  const part = core.documentTarget(xml).parts.find(p=>p.text==='30秒');
  assert.deepEqual(part.conditions,['product=ML307R','audience=developer']);
  const selected = core.target(xml,part.start,part.end);assert.deepEqual(selected.parts[0].conditions,part.conditions);
});
