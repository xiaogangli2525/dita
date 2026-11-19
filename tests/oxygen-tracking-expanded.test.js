'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const tracking = require('../public/oxygen-tracking'), oxygen = require('../public/oxygen-core');
const renderer = require('../public/author-renderer'), authorSource = require('../public/author-source');
const { buildMockDom } = require('./dom-mock');

const meta = { author: '跨端 QA & 研发', timestamp: '20261117T083000+0000', id: 'dita-expanded' };
const encode = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const topic = code => '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\n' +
  '<topic id="expanded"><title>跨端测试</title><body><codeblock id="code">' + code + '</codeblock></body></topic>';
function verify(before, after, options = meta) {
  const revision = tracking.trackEdit(before, after, options);
  assert.equal(tracking.resolveForReview(revision, false), before, '拒绝必须精确恢复原 XML');
  assert.equal(tracking.resolveForReview(revision, true), after, '接受必须精确得到目标 XML');
  const records = oxygen.collectOxyTrackedChanges(revision), ids = records.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, '每个修订 ID 必须唯一');
  return revision;
}

test('multi-line code operations round-trip complete lines, blank lines, tabs, mixed entities and Unicode', () => {
  const before = 'AT+OPEN\r\n\tTIMEOUT=30\r\n\r\n    OLD_A\r\n    OLD_B\r\n    AT+SEND &amp; &lt;OK&gt;\r\n';
  const values = [
    '', 'NEW_FIRST\r\n' + before, before + '\r\n\tNEW_LAST\r\n',
    before.replace('    OLD_A\r\n    OLD_B\r\n', ''),
    before.replace('    OLD_A\r\n    OLD_B', '    NEW_A\r\n\r\n\tNEW_B'),
    before.replaceAll('\r\n', '\n'), before.replaceAll('\t', '    '),
    '中文😀 e\u0301 👨‍👩‍👧‍👦\n&quot;A&#38;B&quot; ?&gt; &lt;node&gt;\n\tEND\n',
    '&#65; &amp; &#x1F600;\r\n', '\r\n\r\n\t  \r\n'
  ];
  for (const after of values) verify(topic(before), topic(after));
});

test('text in title, inline formatting, lists, table cells and footnotes changes without altering DITA structure', () => {
  const before = '<topic id="contexts"><title>HTTP 旧标题</title><body>' +
    '<p product="M1">请求 <b>旧参数</b>，单位 <i>秒</i>。<fn id="note">仅型号 A</fn></p>' +
    '<ul><li>旧项目 A</li><li>旧项目 B</li></ul><ol><li>先连接</li><li>再发送</li></ol>' +
    '<table><tgroup cols="2"><tbody><row><entry>timeout</entry><entry>30</entry></row>' +
    '<row><entry>mode</entry><entry>旧模式</entry></row></tbody></tgroup></table>' +
    '<codeblock id="code">TIMEOUT=30\n    SEND</codeblock></body></topic>';
  const after = before.replace('旧标题', '新标题').replace('旧参数', '新参数 &amp; 参数二').replace('>秒<', '>毫秒<')
    .replace('仅型号 A', '型号 A、B 😀').replace('旧项目 A', '新项目 A').replace('旧项目 B', '新项目 B')
    .replace('先连接', '建立连接').replace('再发送', '发送数据').replace('>30<', '>60<').replace('旧模式', '新模式')
    .replace('TIMEOUT=30', 'TIMEOUT=60\n\n    ADDED');
  const revision = verify(before, after);
  const { document } = buildMockDom(), view = renderer.createAuthorTopic(revision, document, true);
  assert.ok(view.querySelector('pre').querySelectorAll('span').some(s => s.className === 'oxy-insert'));
  assert.match(revision, /product="M1"/);
});

test('deterministic text-edit matrix covers 2500 insertion, deletion and replacement combinations', () => {
  let seed = 0x1a2b3c4d;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const alphabet = ['A', 'B', 'C', ' ', '\t', '\n', '\r\n', '&', '<', '>', '"', "'", '?', '中', '文', '😀', 'e\u0301', '🚀'];
  const value = () => Array.from({ length: random(45) }, () => alphabet[random(alphabet.length)]).join('');
  for (let n = 0; n < 2500; n++) {
    const before = value(), chars = Array.from(before), begin = random(chars.length + 1), end = begin + random(chars.length - begin + 1);
    const after = chars.slice(0, begin).join('') + value() + chars.slice(end).join('');
    try { verify(topic(encode(before)), topic(encode(after))); }
    catch (error) { error.message += '\ncase=' + n + ' seed=' + seed + '\nbefore=' + JSON.stringify(before) + '\nafter=' + JSON.stringify(after); throw error; }
  }
});

test('continuous code editing across serialized reloads preserves the first rejection base', () => {
  const { document } = buildMockDom();
  const original = tracking.setEnabled(topic('AT+OPEN\n    TIMEOUT=30\n    OLD\n'), true);
  const edits = [
    'AT+OPEN\n    TIMEOUT=60\n    OLD\n',
    'AT+OPEN\n    TIMEOUT=60\n\n    NEW\n',
    'AT+OPEN\n    TIMEOUT=70\n\n    NEW\n',
    'AT+OPEN\n    TIMEOUT=70\n\n    NEW & <OK> 😀\n',
    'AT+OPEN\n    TIMEOUT=70\n\n    NEW & <OK> 😀\n    END',
    'AT+OPEN\n    TIMEOUT=70\n\n    NEW & <OK> 😀\n    END_MORE'
  ];
  let current = original;
  for (const text of edits) {
    current = JSON.parse(JSON.stringify(current));
    const view = renderer.createAuthorTopic(current, document, false);
    view.querySelector('pre').textContent = text;
    current = tracking.trackEdit(current, authorSource.updateSource(current, view), meta);
    assert.equal(tracking.resolveForReview(current, false), original);
    assert.equal(tracking.resolveForReview(current, true), tracking.setEnabled(topic(encode(text)), true));
  }
  const view = renderer.createAuthorTopic(current, document, false);
  view.querySelector('pre').textContent = 'AT+OPEN\n\tTIMEOUT=75\n';
  assert.throws(() => authorSource.updateSource(current, view), /跨过批注或修订标记/, '跨已有修订边界仍须明确阻止');
});

test('regular Author replacement across comment boundaries preserves their exact bytes and order', () => {
  const { document } = buildMockDom();
  const start = '<?oxy_comment_start author="QA" comment="保留 &amp; 核对" id="QA-1"?>';
  const end = '<?oxy_comment_end?>', comment = '<!--结构说明-->';
  const original = '<topic id="t"><title>批注</title><body><p>开头前' + start + '批注' + comment + '正文' + end + '尾部 &amp; 结束</p></body></topic>';
  const view = renderer.createAuthorTopic(original, document, false);
  view.querySelector('p').textContent = '开头替换 😀部 & 结束';
  const current = authorSource.updateSource(original, view);
  assert.equal(current, '<topic id="t"><title>批注</title><body><p>开头替换 😀' + start + comment + end + '部 &amp; 结束</p></body></topic>');
  const tracked = tracking.trackEdit(original, current, meta);
  assert.equal(tracking.resolve(tracked, false), original);
  assert.equal(tracking.resolve(tracked, true), current);
  assert.throws(() => tracking.trackEdit(original, current.replace(comment, ''), meta), /第一版/);
  assert.throws(() => tracking.trackEdit(original, current.replace('保留 &amp; 核对', '已修改批注'), meta), /第一版/);
});

test('tracked Author replacement crosses eligible prior revisions while undoing them still restores the original XML', () => {
  const { document } = buildMockDom();
  const original = topic('AT+OPEN &amp; OLD\r\n    TIMEOUT=30\r\nFINAL');
  const oldEdit = original.replace('TIMEOUT=30', 'TIMEOUT=60');
  const amended = tracking.trackEdit(original, oldEdit, meta);
  const target = 'AT+NEW &amp; OK\r\nFINAL';
  const replace = source => {
    const view = renderer.createAuthorTopic(source, document, false);
    view.querySelector('pre').textContent = 'AT+NEW & OK\nFINAL';
    return authorSource.updateSource(source, view, true);
  };
  const changes = tracking.trackEdit(amended, replace(amended), { ...meta, id: 'dita-amend' });
  assert.equal(tracking.resolve(changes, false), original);
  assert.equal(tracking.resolve(changes, true), topic(target));
  for (const protectedSource of [
    amended.replaceAll('跨端 QA &amp; 研发', '外部作者'),
    amended.replace(/ id="dita-[^"]*"/g, ''),
    amended.replace('<?oxy_insert_start ', '<?oxy_insert_start flag="done" ')
  ]) assert.throws(() => tracking.trackEdit(protectedSource, replace(protectedSource), meta), /第一版/);
});

test('prose typing after a browser NBSP or collapsed whitespace preserves pending revisions', () => {
  const { document } = buildMockDom();
  const original = '<topic id="t"><title>T</title><body><p id="p">HTTP 请求默认超时为 30 秒。</p></body></topic>';
  for (const space of ['\u00a0', '  ', '\t', '\r\n  ']) {
    const previous = original.replace('HTTP 请求默认超时为 30 秒。', 'HTTP' + space);
    const current = tracking.trackEdit(original, previous, meta);
    const view = renderer.createAuthorTopic(current, document, false);
    assert.match(view.querySelector('p').textContent, /^HTTP +$/);
    view.querySelector('p').textContent += '新内容';
    const result = tracking.trackEdit(current, authorSource.updateSource(current, view), meta);
    assert.equal(tracking.resolveForReview(result, false), original);
    assert.match(tracking.resolveForReview(result, true), /HTTP[^]*新内容/);
  }
});

test('unsupported list rows, table rows, formatting and attribute edits are rejected without accepting earlier changes', () => {
  const before = '<topic id="t"><title>T</title><body><ul><li>A</li><li>B</li></ul>' +
    '<table><tgroup cols="1"><tbody><row><entry>30</entry></row></tbody></tgroup></table><p id="p">OLD</p></body></topic>';
  const changed = tracking.trackEdit(before, before.replace('OLD', 'NEW'), meta);
  for (const next of [
    changed.replace('<li>B</li>', ''), changed.replace('<li>B</li>', '<li>B</li><li>C</li>'),
    changed.replace('</tbody>', '<row><entry>60</entry></row></tbody>'),
    changed.replace('<row><entry>30</entry></row>', ''), changed.replace('id="p"', 'id="changed"'),
    changed.replace('<entry>30</entry>', '<entry><b>30</b></entry>')
  ]) assert.throws(() => tracking.trackEdit(changed, next, meta), /第一版/);
  assert.equal(tracking.resolveForReview(changed, false), before);
});

test('large code replacement keeps both full alternatives and bounds native revision count', () => {
  const before = Array.from({ length: 1200 }, (_, n) => '    PARAM_' + n + '=OLD\n').join('');
  const after = Array.from({ length: 1200 }, (_, n) => '    PARAM_' + n + '=NEW 😀\n').join('');
  const revision = verify(topic(before), topic(encode(after)));
  assert.ok(oxygen.collectOxyTrackedChanges(revision).length <= 2400);
});

test('actual Web Author 28.1 native records render and resolve without project-generated IDs', () => {
  // Downloaded from the official demo after editing a synthetic DITA document.
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/oxygen-webauthor-28.1-native.dita'), 'utf8');
  const changes = oxygen.collectOxyTrackedChanges(source);
  assert.equal(changes.length, 4);
  assert.ok(changes.every(c => c.author === 'Anonymous' && !c.id));
  assert.match(tracking.resolveForReview(source, true), /TIMEOUT=90/);
  assert.match(tracking.resolveForReview(source, true), /新版 &amp; &lt;OK>/);
  assert.match(tracking.resolveForReview(source, false), /TIMEOUT=30/);
  assert.match(tracking.resolveForReview(source, false), /旧值/);
  const { document } = buildMockDom(), view = renderer.createAuthorTopic(source, document, true);
  const markers = view.querySelectorAll('span');
  assert.equal(markers.filter(s => s.className === 'oxy-insert').length, 2);
  assert.equal(markers.filter(s => s.className === 'oxy-delete').length, 2);
});
