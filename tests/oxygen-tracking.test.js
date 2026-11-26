'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const tracking = require('../public/oxygen-tracking'), oxygen = require('../public/oxygen-core');
const { buildMockDom } = require('./dom-mock');
const author = require('../public/author-renderer'), source = require('../public/author-source');
const store = require('../public/document-store');
const meta = { author: '研发 & QA', timestamp: '20261117T081500+0000', id: 'dita-fixture' };
const topic = text => '<topic id="t"><title>HTTP</title><body><codeblock id="code">' + text + '</codeblock><p id="tail">保持</p></body></topic>';
function check(before, after) {
  const result = tracking.trackEdit(before, after, meta);
  assert.equal(tracking.resolve(result, true), after);
  assert.equal(tracking.resolve(result, false), before);
  return result;
}
test('Oxygen mode preserves declarations, CRLF and unrelated options without changing existing revisions', () => {
  const original = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep-->\r\n' + topic('AT+OPEN') + '\r\n<?tail keep?>\r\n';
  const enabled = tracking.setEnabled(original, true);
  assert.ok(enabled.startsWith(original)); assert.equal(tracking.enabled(enabled), true);
  const off = tracking.setEnabled(enabled, false); assert.equal(tracking.enabled(off), false); assert.match(off, /track_changes="off"/);
  assert.equal(tracking.setEnabled(enabled, true), enabled);
  assert.equal(tracking.enabled('<!--<?oxy_options track_changes="on"?>-->' + topic('')), false);
  assert.equal(tracking.enabled('<topic'), false);
  assert.match(tracking.setEnabled(topic('') + '<?oxy_options other="yes" track_changes=\'off\'?>', true), /other="yes" track_changes="on"/);
});
test('code insertions, deletions, replacements and blank lines preserve exact tabs, CRLF and Unicode', () => {
  for (const [old, next] of [
    ['AT+OPEN\r\n\tTIMEOUT=30\r\n', 'AT+OPEN\r\n\tTIMEOUT=60\r\n'],
    ['AT+OPEN\n', 'AT+OPEN\n    AT+SEND\n\n'],
    ['AT+OPEN\n    AT+SEND\n', 'AT+OPEN\n'],
    ['AT+OPEN\n    AT+SEND', 'AT+OPEN\n\tAT+SEND'],
    ['中文😀&amp;&lt;OK&gt;', '中😀文&amp;&lt;FAIL&gt;'],
    ['&quot;A&#x26;B&quot;\n', '&quot;C&amp;D&quot;\n']
  ]) check(tracking.setEnabled(topic(old), true), tracking.setEnabled(topic(next), true));
});
test('native PI parsing ignores instructions inside XML comments and CDATA, and retains all code preview lines', () => {
  const fake = '<!--<?oxy_delete content="fake"?>--><![CDATA[<?oxy_delete content="fake"?>]]>';
  assert.equal(oxygen.collectOxyTrackedChanges(fake).length, 0);
  const text = 'AT+OPEN\n    AT+SEND\n\nOK';
  const revision = check(topic(''), topic(text));
  assert.equal(oxygen.collectOxyTrackedChanges(revision)[0].content, text);
  assert.throws(() => oxygen.collectOxyTrackedChanges('<?oxy_insert_start?>x'), /对应终点/);
  assert.throws(() => oxygen.collectOxyTrackedChanges('<?oxy_insert_end?>'), /对应起点/);
});
test('deleted XML text is escaped twice for PI content and restores entities without corruption', () => {
  const before = topic('A &amp; B &lt; C &quot;D&quot; ?&gt; 😀');
  const result = check(before, topic(''));
  assert.match(result, /&amp;amp;/); assert.match(result, /&amp;lt;/);
  const changes = oxygen.collectOxyTrackedChanges(result);
  assert.equal(changes[0].content, 'A & B < C "D" ?> 😀');
});
test('continuous Author code input merges into native changes and keeps the original rejection base across reload', () => {
  const { document } = buildMockDom();
  const original = tracking.setEnabled(topic('AT+OPEN\n    AT+SEND'), true);
  let current = original;
  for (const value of ['AT+OPEN\n    AT+SEND X', 'AT+OPEN\n    AT+SEND XY', 'AT+OPEN\n    AT+SEND X', 'AT+OPEN\n    AT+SEND XYZ']) {
    const view = author.createAuthorTopic(current, document, false);
    view.querySelector('pre').textContent = value;
    const candidate = source.updateSource(current, view);
    current = tracking.trackEdit(current, candidate, meta);
    assert.equal(tracking.resolve(current, false), original);
    assert.equal(tracking.resolve(current, true), original.replace('AT+SEND', value.split('\n')[1].trim()));
    assert.equal(oxygen.collectOxyTrackedChanges(current).length, 1);
  }
});
test('own replacement edits keep the original value rather than accepting earlier revisions', () => {
  const { document } = buildMockDom(), original = tracking.setEnabled(topic('30'), true);
  let current = tracking.trackEdit(original, original.replace('30', '60'), meta);
  const view = author.createAuthorTopic(current, document, false); view.querySelector('pre').textContent = '70';
  current = tracking.trackEdit(current, source.updateSource(current, view), meta);
  assert.equal(tracking.resolve(current, false), original);
  assert.equal(tracking.resolve(current, true), original.replace('30', '70'));
});
test('review code decorations keep source order, deleted entities, lines and insertion text', () => {
  const { document } = buildMockDom(), before = topic('A &amp; B\n    OLD\n'), after = topic('A &amp; B\n    NEW\n');
  const tracked = check(before, after), view = author.createAuthorTopic(tracked, document, true);
  const code = view.querySelector('pre');
  assert.ok(code.textContent.includes('\n    '));
  assert.equal(code.querySelectorAll('span').find(node => node.className === 'oxy-delete').textContent, 'OLD');
  assert.equal(code.querySelectorAll('span').find(node => node.className === 'oxy-insert').textContent, 'NEW');
  assert.equal(code.querySelectorAll('span').find(node => node.className === 'oxy-delete').getAttribute('data-oxy-index'), '0');
  assert.equal(code.querySelectorAll('span').find(node => node.className === 'oxy-insert').getAttribute('data-oxy-index'), '1');
});
test('text revisions retain DITA attributes, table cell context and unrelated imported changes', () => {
  const before = '<topic><title>T</title><body><p product="M1"><b>old</b> text</p><table><tgroup cols="1"><tbody><row><entry>30</entry></row></tbody></tgroup></table><p><?oxy_insert_start author="Other"?>keep<?oxy_insert_end?></p></body></topic>';
  const after = before.replace('>old<', '>new<').replace('>30<', '>60<');
  const result = tracking.trackEdit(before, after, meta);
  assert.match(result, /product="M1"/); assert.ok(result.includes('<?oxy_insert_start author="Other"?>keep<?oxy_insert_end?>'));
  assert.equal(oxygen.collectOxyTrackedChanges(result).filter(c => c.author === 'Other').length, 1);
});
test('unsupported structure, attributes, CDATA, references, foreign metadata and PI edits fail before mutation', () => {
  const before = topic('OLD');
  for (const next of [before.replace('id="code"', 'id="changed"'), before.replace('<p id="tail">保持</p>', ''), before.replace('OLD', '<b>NEW</b>')]) assert.throws(() => tracking.trackEdit(before, next, meta), /第一版/);
  for (const raw of ['<![CDATA[OLD]]>', '<?other_annotation keep?>OLD', '<?oxy_attributes a="x"?>OLD']) {
    assert.throws(() => tracking.trackEdit(topic(raw), topic(raw.replace('OLD', 'NEW')), meta), /第一版/);
  }
  const foreign = topic('<?oxy_insert_start author="Other"?>OLD<?oxy_insert_end?>');
  assert.throws(() => tracking.trackEdit(foreign, foreign.replace('OLD', 'NEW'), meta), /其他作者或外部导入/);
  assert.throws(() => tracking.trackEdit(topic('<ph conref="other#t/p">OLD</ph>'), topic('<ph conref="other#t/p">NEW</ph>'), meta), /第一版/);
  const original = tracking.setEnabled(before, true), revision = tracking.trackEdit(original, original.replace('OLD', 'NEW'), meta);
  assert.throws(() => tracking.trackEdit(revision, revision.replace('研发 &amp; QA', 'Someone'), meta), /第一版/);
});
test('undo and redo restore exact native sources, including the tracking option', () => {
  const original = topic('OLD'), enabled = tracking.setEnabled(original, true), file = store.createDocument({ path: 'a.dita', content: original });
  store.editDocument(file, enabled); const changed = tracking.trackEdit(enabled, enabled.replace('OLD', 'NEW'), meta); store.editDocument(file, changed);
  store.travelHistory(file, 'undo'); assert.equal(file.current, enabled);
  store.travelHistory(file, 'undo'); assert.equal(file.current, original);
  store.travelHistory(file, 'redo'); store.travelHistory(file, 'redo'); assert.equal(file.current, changed);
});
test('a foreign revision surrounding an element also protects the text inside that element', () => {
  const before = '<topic><title>T</title><body><?oxy_insert_start author="Other"?><p>OLD</p><?oxy_insert_end?><p>safe</p></body></topic>';
  assert.throws(() => tracking.trackEdit(before, before.replace('OLD', 'NEW'), meta), /第一版/);
  const result = tracking.trackEdit(before, before.replace('safe', 'changed'), meta);
  assert.ok(result.includes('<?oxy_insert_start author="Other"?><p>OLD</p><?oxy_insert_end?>'));
});
test('delivery blocks new pending records while note numbering and legacy imports remain usable', () => {
  const domain = require('../public/manual-domain'), original = topic('OLD');
  const revision = tracking.trackEdit(original, original.replace('OLD', 'NEW'), meta);
  const snapshot = { path: 'a.dita', content: revision, map: { children: [{ path: 'a.dita' }] }, files: new Map([['a.dita', { current: revision }]]), project: { models: [] } };
  assert.throws(() => domain.prepare(snapshot), /Oxygen 修订/);
  assert.doesNotThrow(() => domain.listNotes(snapshot));
  const legacy = revision.replace(/ id="dita-[^"]*"/g, '');
  assert.doesNotThrow(() => domain.prepare({ ...snapshot, content: legacy, files: new Map([['a.dita', { current: legacy }]]) }));
});
test('publication scopes unpaired Oxygen markers to DITAVAL without relaxing the review of paired records', () => {
  const domain = require('../public/manual-domain');
  const filter = { current: '<val><prop att="product" val="tbd" action="exclude"/></val>' };
  function prepare(body, activeFilter) {
    const source = topic('').replace('</body>', body + '</body>');
    return domain.prepare({ path: 'a.dita', map: { children: [{ type: 'file', path: 'a.dita' }] }, files: new Map([['a.dita', { current: source }]]), project: { models: [] }, filter: activeFilter });
  }
  const start = '<?oxy_insert_start?>', end = '<?oxy_comment_end mid="lost"?>';
  const hidden = '<div product="tbd"><p>' + start + 'EXCLUDED' + end + '</p></div>';
  const data = prepare(hidden + '<p><?oxy_insert_start?>Imported<?oxy_insert_end?></p>', filter);
  assert.doesNotMatch(data.files.get('a.dita').current, /EXCLUDED/);
  assert.equal(data.oxygenRevisions, 1);
  assert.throws(() => prepare(hidden), /Oxygen 修订结束标记没有对应起点/);
  assert.throws(() => prepare(hidden + '<p>' + start + 'Visible</p>', filter), error => {
    const [{ path, location }] = error.issues;
    assert.equal(path, 'a.dita');
    assert.equal(location.start, location.source.lastIndexOf(start));
    assert.equal(location.source.slice(location.start, location.end), start);
    return true;
  });
  for (const body of [
    '<p product="tbd"><?oxy_insert_start id="dita-cross"?>hidden</p><p>visible<?oxy_insert_end?></p>',
    '<p product="tbd"><?oxy_insert_start id="dita-pending"?>hidden<?oxy_insert_end?></p>'
  ]) assert.throws(() => prepare(body, filter), /尚有未处理的 Oxygen 修订/);
});

test('conref cannot reintroduce a malformed revision excluded at its source', () => {
  const domain = require('../public/manual-domain');
  const filter = { current: '<val><prop att="product" val="tbd" action="exclude"/></val>' };
  const shared = '<topic id="s"><body><div id="safe"><p id="hidden" product="tbd"><?oxy_insert_start?>PRIVATE</p></div><p id="alias" conref="#s/hidden"/></body></topic>';
  function prepare(ref, other = shared) {
    const current = '<topic id="a"><body><p>Visible</p>' + ref + '</body></topic>';
    const files = new Map([['a.dita', { current }], ['shared.dita', { current: other }]]);
    return domain.prepare({ path: 'a.dita', map: { children: [{ type: 'file', path: 'a.dita' }] }, files, project: { models: [] }, filter });
  }
  for (const ref of ['<div conref="shared.dita#s/safe"/>', '<p conref="shared.dita#s/hidden"/>']) {
    assert.doesNotMatch(prepare(ref).files.get('a.dita').current, /PRIVATE|oxy_/);
  }
  const revived = '<p conref="shared.dita#s/hidden" product="public"/>';
  assert.throws(() => prepare(revived), error => {
    assert.match(error.message, /复用目标包含不完整的 Oxygen 修订.*shared\.dita#s\/hidden/);
    const [{ path, location }] = error.issues;
    assert.equal(path, 'a.dita');
    assert.equal(location.source.slice(location.start, location.end), revived);
    return true;
  });
  assert.throws(() => prepare(revived.replace('#s/hidden', '#s/alias')), /复用目标包含不完整的 Oxygen 修订.*shared\.dita#s\/hidden/);
  assert.throws(() => prepare('<p conref="shared.dita#s/hidden"/>', shared.replace('<div id="safe">', '<div id="safe" product="tbd">').replace('id="hidden" product="tbd"', 'id="hidden"')), /复用目标包含不完整的 Oxygen 修订/);
});
test('empty self-closing code blocks allow first text entry without losing identifiers or attributes', () => {
  const before = '<topic><title>T</title><body><codeblock id="code" xml:space="preserve"/></body></topic>';
  const after = before.replace('preserve"/>', 'preserve">AT+OPEN\n    AT+SEND</codeblock>');
  const tracked = tracking.trackEdit(before, after, meta);
  assert.equal(tracking.resolve(tracked, true), after);
  assert.equal(tracking.resolve(tracked, false), before.replace('preserve"/>', 'preserve"></codeblock>'));
  assert.throws(() => tracking.trackEdit(before.replace('id="code"', 'id="code" conref="a#t/p"'), after.replace('id="code"', 'id="code" conref="a#t/p"'), meta), /第一版/);
});
test('editing enriched Oxygen records cannot discard comments, flags, or reply associations', () => {
  const original = topic('30'), plain = tracking.trackEdit(original, original.replace('30', '60'), meta);
  for (const attribute of ['comment="请核对"', 'flag="done"', 'other="preserve"']) {
    const before = plain.replace('<?oxy_insert_start ', '<?oxy_insert_start ' + attribute + ' ');
    const after = before.replace('?>6<?oxy_insert_end?>', '?>7<?oxy_insert_end?>');
    assert.throws(() => tracking.trackEdit(before, after, meta), /第一版/);
  }
  const threaded = plain.replace('</body>', '<?oxy_comment_start parentID="dita-fixture-1" mid="m" comment="Reply"?>text<?oxy_comment_end mid="m"?></body>');
  assert.equal(oxygen.hasUnsupportedChanges(threaded), true);
  assert.throws(() => tracking.trackEdit(threaded, threaded.replace('<title>HTTP', '<title>New'), meta), /第一版/);
});
test('review restores only valid complete XML and preserves legacy comment acceptance behavior', () => {
  const bad = '<topic><title>T</title><body><?oxy_delete author="A" content="&lt;p&gt;unfinished"?></body></topic>';
  assert.throws(() => tracking.resolveForReview(bad, false), /Unclosed|Unexpected|Mismatched/);
  assert.equal(tracking.resolveForReview(bad, true), '<topic><title>T</title><body></body></topic>');
  const comment = '<topic><title>T</title><body><p><?oxy_comment_start author="A" comment="Review"?>正文<?oxy_comment_end?></p></body></topic>';
  assert.equal(tracking.resolveForReview(comment, true), '<topic><title>T</title><body><p>正文</p></body></topic>');
  assert.equal(tracking.resolveForReview(comment, false), '<topic><title>T</title><body><p>正文</p></body></topic>');
  assert.throws(() => tracking.resolveForReview('<topic><title>T</title><?oxy_attributes a="x"?></topic>', true), /尚不支持/);
});
test('one multi-block edit generates distinct native revision IDs across titles, paragraphs and code', () => {
  const before = '<topic><title>Old</title><body><p>Old</p><codeblock>Old</codeblock><codeblock/></body></topic>';
  const after = '<topic><title>New</title><body><p>New</p><codeblock>New</codeblock><codeblock>First</codeblock></body></topic>';
  const result = tracking.trackEdit(before, after, meta), records = oxygen.collectOxyTrackedChanges(result);
  assert.equal(records.length, 7); assert.equal(new Set(records.map(c => c.id)).size, records.length);
  assert.equal(tracking.resolve(result, true), after);
  assert.equal(tracking.resolve(result, false), before.replace('<codeblock/>', '<codeblock></codeblock>'));
});
test('restoring deleted content cannot silently leave unsupported native attribute records behind', () => {
  const before = '<topic><title>T</title><body><?oxy_delete content="&lt;p&gt;&lt;?oxy_attributes a=&quot;x&quot;?&gt;text&lt;/p&gt;"?></body></topic>';
  assert.throws(() => tracking.resolveForReview(before, false), /尚不支持/);
  const [deletion] = oxygen.collectOxyTrackedChanges(before);
  assert.throws(() => tracking.resolveChangeForReview(before, deletion, false), /尚不支持/);
  const reply = before.replace('oxy_attributes a=&quot;x&quot;?&gt;text', 'oxy_comment_start parentID=&quot;qa&quot;?&gt;text&lt;?oxy_comment_end?&gt;');
  assert.throws(() => tracking.resolveForReview(reply, false), /尚不支持/);
});

test('review keeps both boundaries of overlapping Oxygen changes intact', () => {
  const insert = '<?oxy_insert_start author="Writer"?>', insertEnd = '<?oxy_insert_end?>';
  const comment = '<?oxy_comment_start mid="qa" comment="Check"?>', commentEnd = '<?oxy_comment_end mid="qa"?>';
  for (const [inside, restored] of [
    [insert + 'new ' + comment + 'words' + insertEnd + ' unchanged' + commentEnd, ' unchanged'],
    [comment + 'original ' + insert + 'new' + commentEnd + ' words' + insertEnd, 'original ']
  ]) {
    const before = topic(inside);
    const records = oxygen.collectOxyTrackedChanges(before);
    const insertion = records.find(change => change.type === 'insert');
    assert.throws(() => tracking.resolveChangeForReview(before, insertion, false), /破坏其他修订或批注/);
    const accepted = tracking.resolveChangeForReview(before, insertion, true);
    assert.deepEqual(oxygen.collectOxyTrackedChanges(accepted).map(change => change.type), ['comment']);
    assert.equal(tracking.resolveForReview(before, false), topic(restored));
  }
});

test('bulk review removes exact Oxygen comment instructions and preserves similarly named instructions and literals', () => {
  const literal = '<![CDATA[<?oxy_comment_end?>]]><?oxy_comment_start-extra keep?><?oxy_comment_end-extra keep?>';
  const before = topic(literal + '<?oxy_comment_start?>retain<?oxy_comment_end?>');
  assert.equal(oxygen.collectOxyTrackedChanges(before).length, 1);
  assert.equal(tracking.resolveForReview(before, true), topic(literal + 'retain'));
});
