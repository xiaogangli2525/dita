'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core'), iconv = require('iconv-lite');

test('basic writing commands preserve content, structure, applicability and undo ownership', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-basic-writing-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="a"><title>手册标题</title><body>\r\n' +
    '<p id="conditioned" product="M100">型号段落</p><p id="different" product="M200">另一型号</p>\r\n' +
    '<p id="plain">ABCDEF</p><p id="tail">GHIJKL</p><p id="rich"><b id="bold">前半后半</b></p>\r\n' +
    '<ul id="list"><li id="one">ONE</li><li id="two">TWO</li><li id="three">THREE</li></ul>\r\n' +
    '<codeblock id="code">AT+OPEN\r\n    AT+SEND</codeblock>\r\n' +
    '<table id="params"><tgroup cols="2"><thead><row><entry>参数</entry><entry>说明</entry></row></thead><tbody><row><entry>A</entry><entry>B</entry></row></tbody></tgroup></table>\r\n' +
    '<table id="merged"><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry namest="c1" nameend="c2">合并</entry></row></tbody></tgroup></table>\r\n' +
    '<p id="notes">注脚前<fn product="M100">适用说明</fn>注脚后</p>\r\n' +
    '<p id="picture"><image id="pic" href="assets/one.svg" width="80mm"><alt id="alt-id">原图说明</alt><longdescref href="b.dita"/></image></p>\r\n' +
    '<p id="links"><xref id="link" href="b.dita#b" outputclass="keep"><b id="link-bold">已有</b>链接</xref></p>\r\n' +
    '</body></topic>\r\n<?tail keep?>';
  const other = '<topic id="b"><title>另一个文档</title><body><p id="other">保持另一章</p></body></topic>', map = '<map><title>功能手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>';
  await fs.writeFile(path.join(repo, 'a.dita'), iconv.encode(original, 'gbk')); await fs.writeFile(path.join(repo, 'b.dita'), other); await fs.writeFile(path.join(repo, 'main.ditamap'), map);
  await fs.mkdir(path.join(repo, 'assets'));
  for (const name of ['one', 'two']) await fs.writeFile(path.join(repo, 'assets', name + '.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>');
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const number = socket.address().port; socket.close(() => resolve(number)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const current = (file = 'a.dita') => page.evaluate(file => window.DitaApp.state.filesMap.get(file).current, file);
  const open = async file => { await page.click('[data-view=search]'); await page.fill('#workspaceSearchInput', file); await page.locator('.workspace-result').filter({ hasText: file }).click(); await page.waitForFunction(file => window.DitaApp.state.activePath === file, file); };
  const reset = async () => page.evaluate(original => { const A = window.DitaApp, file = A.state.filesMap.get('a.dita'); A.setFileContent(file, original); file.history = { undo: [], redo: [] }; }, original);
  async function select(selector, start, end = start, endSelector = selector) {
    await page.locator(selector).click();
    await page.evaluate(({ selector, start, end, endSelector }) => {
      function point(selector, offset) { const block = document.querySelector(selector), walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; } return [block, block.childNodes.length]; }
      const range = document.createRange(); range.setStart(...point(selector, start)); range.setEnd(...point(endSelector, end));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, { selector, start, end, endSelector });
  }
  const undo = () => page.click('#authorUndoButton');
  const redo = () => page.click('#authorRedoButton');
  async function paste(text, html = '') {
    await page.evaluate(async ({ text, html }) => { const data = { 'text/plain': new Blob([text], { type: 'text/plain' }) }; if (html) data['text/html'] = new Blob([html], { type: 'text/html' }); await navigator.clipboard.write([new ClipboardItem(data)]); }, { text, html });
    await page.keyboard.press('Control+v');
  }
  async function preserved() {
    const content = await current(); assert.ok(content.startsWith('<?xml version="1.0" encoding="GBK"?>\r\n<!--keep-->')); assert.ok(content.endsWith('\r\n<?tail keep?>'));
    assert.match(content, /<fn product="M100">适用说明<\/fn>/);
    const ids = await page.evaluate(content => [...new DOMParser().parseFromString(content, 'application/xml').querySelectorAll('[id]')].map(node => node.id), content); assert.equal(new Set(ids).size, ids.length);
  }
  await open('a.dita');
  t.beforeEach(async () => { await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(node => node.close()); window.DitaApp.setMode('visual'); }); await reset(); });

  await t.test('Enter in a title retains its complete text through save and mode changes', async () => {
    await select('#visualEditor h2', 2); await page.keyboard.press('Enter'); assert.equal(await current(), original); assert.equal(await page.locator('#visualEditor h2').textContent(), '手册标题');
    await page.keyboard.insertText('新正文'); await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty);
    assert.match(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), /<title>手册标题<\/title>/);
    await page.evaluate(() => { window.DitaApp.setMode('editor'); window.DitaApp.setMode('visual'); }); assert.equal(await page.locator('#visualEditor h2').textContent(), '手册标题'); await reset();
  });
  await t.test('paragraph splitting preserves conditions, mixed inline text, unique IDs and exact undo', async () => {
    await select('#conditioned', 2); await page.keyboard.press('Enter'); assert.match(await current(), /<p id="conditioned" product="M100">型号<\/p>\s*<p product="M100">段落<\/p>/); await undo(); assert.equal(await current(), original);
    await select('#rich', 2); await page.keyboard.press('Enter'); const changed = await current(); assert.match(changed, /<p id="rich"><b id="bold">前半<\/b><\/p>\s*<p><b>后半<\/b><\/p>/); await preserved(); await undo(); assert.equal(await current(), original); await redo(); assert.equal(await current(), changed); await undo();
  });
  await t.test('code Enter and Tab preserve literal newlines and indentation without HTML tags', async () => {
    await select('#code', 20); await page.keyboard.press('Enter'); assert.match(await current(), / {4}AT\+SEND\r\n {4}<\/codeblock>/); assert.doesNotMatch(await current(), /<br/); await undo(); assert.equal(await current(), original);
    await select('#code', 7); await page.keyboard.press('Tab'); assert.match(await current(), /AT\+OPEN {4}\r\n/); await undo();
    await select('#code', 0, 20); await page.keyboard.press('Tab'); assert.match(await current(), / {4}AT\+OPEN\r\n {8}AT\+SEND/); await page.keyboard.press('Shift+Tab'); assert.equal(await current(), original); await reset();
  });
  await t.test('empty list Enter exits to a paragraph; Tab and Shift+Tab change list hierarchy', async () => {
    await select('#three', 5); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); assert.match(await current(), /<\/ul>\s*<p\/>\s*<codeblock/); assert.doesNotMatch(await current(), /<div|<br/); await undo(); await undo(); assert.equal(await current(), original);
    await select('#two', 2); await page.keyboard.press('Tab'); assert.match(await current(), /<li id="one">ONE<ul><li id="two">TWO<\/li><\/ul><\/li>/); await page.keyboard.press('Shift+Tab'); assert.equal(await current(), original); await reset();
  });
  await t.test('merges retain anchors while differing applicability and protected selections are blocked', async () => {
    await select('#different', 0); await page.keyboard.press('Backspace'); assert.equal(await current(), original); assert.match(await page.locator('#status').textContent(), /适用条件/);
    await select('#tail', 0); await page.keyboard.press('Backspace'); assert.match(await current(), /<p id="plain">ABCDEF<ph id="tail"\/>GHIJKL<\/p>/); await undo(); assert.equal(await current(), original);
    await select('#notes', 0, 8); await page.keyboard.insertText('不能覆盖'); assert.equal(await current(), original);
    await select('#notes', 3); await page.keyboard.press('Delete'); assert.equal(await current(), original); assert.match(await page.locator('#status').textContent(), /受保护/);
    await page.evaluate(() => { const A = window.DitaApp, file = A.state.filesMap.get('a.dita'); A.setFileContent(file, file.current.replace('<p id="plain">', '<p id="plain" conref="b.dita#b/other">')); });
    const referenced = await current(); await select('#plain', 3); await page.keyboard.insertText('不得改写引用'); assert.equal(await current(), referenced); await reset();
  });
  await t.test('cross-paragraph paste and typing are atomic and retain unselected prefix and tail', async () => {
    await select('#plain', 3, 3, '#tail'); await paste('替换'); assert.match(await current(), /<p id="plain">ABC替换<ph id="tail">JKL<\/ph><\/p>/); await undo(); assert.equal(await current(), original);
    await select('#plain', 3, 3, '#tail'); await page.keyboard.insertText('键入'); assert.match(await current(), /ABC键入<ph id="tail">JKL/); await undo(); assert.equal(await current(), original);
    await select('#conditioned', 1, 2, '#different'); await paste('拒绝'); assert.equal(await current(), original); assert.match(await page.locator('#status').textContent(), /适用条件/);
    await select('#plain', 3, 3, '#tail'); await paste('外部\n文字', '<p><strong>外部</strong></p><p>文字</p>'); assert.match(await current(), /<p><b>外部<\/b><\/p>/); assert.match(await current(), /<ph id="tail">JKL<\/ph>/); await undo(); assert.equal(await current(), original);
  });
  await t.test('table dialog sets header and dimensions; Tab navigates cells and appends one undoable row', async () => {
    await select('#plain', 3); await page.selectOption('#authorInsertSelect', 'table'); await page.fill('#tableRows', '2'); await page.fill('#tableCols', '3'); await page.click('#tableInsertForm button[type=submit]');
    assert.equal(await page.locator('#tableInsertDialog').evaluate(node => node.open), false); assert.match(await current(), /<tgroup cols="3"><thead>/); const inserted = await current(); assert.equal(await page.locator('#visualEditor table').count(), 3); await undo(); assert.equal(await current(), original); await redo(); assert.equal(await current(), inserted); await undo();
    await select('#params td:first-child', 1); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => getSelection().anchorNode.parentElement.closest('td').textContent), 'B'); await page.keyboard.press('Tab'); assert.equal(await page.locator('#params tbody tr').count(), 2); const changed = await current(); await undo(); assert.equal(await current(), original); await redo(); assert.equal(await current(), changed); await undo();
    await select('#merged td', 1); await page.keyboard.press('Tab'); assert.equal(await current(), original); assert.match(await page.locator('#status').textContent(), /合并单元格/);
  });
  await t.test('paragraph/list/note/code conversions retain text and footnotes and are undoable', async () => {
    await select('#plain', 1, 3, '#tail'); await page.selectOption('#authorBlockSelect', 'ol'); assert.match(await current(), /<ol><li id="plain">ABCDEF<\/li><li id="tail">GHIJKL<\/li><\/ol>/); await undo(); assert.equal(await current(), original);
    await select('#two', 1); await page.selectOption('#authorBlockSelect', 'p'); assert.match(await current(), /<\/ul>\s*<p id="two">TWO<\/p>\s*<ul><li id="three">THREE/); await undo(); assert.equal(await current(), original);
    await select('#plain', 2); await page.selectOption('#authorBlockSelect', 'note:warning'); assert.match(await current(), /<note id="plain" type="warning">ABCDEF<\/note>/); await undo();
    await select('#notes', 1); await page.selectOption('#authorBlockSelect', 'ul'); await preserved(); await undo(); assert.equal(await current(), original);
    await select('#plain', 1); await page.selectOption('#authorBlockSelect', 'codeblock'); assert.match(await current(), /<codeblock id="plain">ABCDEF<\/codeblock>/); await undo(); assert.equal(await current(), original);
  });
  await t.test('double-click image edits file, alt and size while retaining child XML and undo', async () => {
    assert.equal(await page.locator('#pic').getAttribute('alt'), '原图说明');
    await require('./browser-ui').openProperties(page); await page.locator('#pic').click(); await page.click('[data-context-action="edit-resource"]'); await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 1); await page.click('#resourceClose'); await require('./browser-ui').closePanel(page);
    await page.locator('#pic').dblclick(); await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 1);
    assert.equal(await page.inputValue('#resourceLabel'), '原图说明'); await page.selectOption('#resourceTarget', { label: 'assets/two.svg' }); await page.fill('#resourceLabel', '替换后的图'); await page.fill('#resourceWidth', '50%'); await page.click('#resourceForm button[type=submit]');
    assert.match(await current(), /<image id="pic" href="assets\/two.svg" width="50%"><alt id="alt-id">替换后的图<\/alt><longdescref href="b.dita"\/><\/image>/); assert.equal(await page.locator('#pic').evaluate(node => node.style.width), '50%'); const edited = await current(); await undo(); assert.equal(await current(), original); await redo(); assert.equal(await current(), edited); await undo();
    await select('#plain', 3); await page.keyboard.insertText('X'); await preserved(); assert.match(await current(), /<alt id="alt-id">原图说明<\/alt><longdescref href="b.dita"\/>/); await undo(); assert.equal(await current(), original);
  });
  await t.test('double-click links edits address and label without deleting inline identities', async () => {
    await page.locator('#link-bold').click(); await require('./browser-ui').openProperties(page); assert.equal(await page.locator('#inspectorElement').textContent(), '链接'); assert.ok(await page.locator('[data-context-action="edit-resource"]').isVisible()); await require('./browser-ui').closePanel(page);
    await page.locator('#link').dblclick(); await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 0); await page.fill('#resourceHref', 'https://example.invalid/guide'); await page.fill('#resourceLabel', '新链接'); await page.click('#resourceForm button[type=submit]');
    assert.match(await current(), /<xref id="link" href="https:\/\/example.invalid\/guide" outputclass="keep" scope="external"><b id="link-bold">新链接<\/b><\/xref>/); await undo(); assert.equal(await current(), original);
    await page.locator('#link').dblclick(); await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 0); await page.fill('#resourceHref', 'javascript:alert(1)'); await page.click('#resourceForm button[type=submit]'); assert.equal(await current(), original); assert.match(await page.locator('#resourceError').textContent(), /有效/); await page.click('#resourceClose');
  });
  await t.test('stale dialogs do not overwrite newer content; compact screens keep controls reachable', async () => {
    await select('#plain', 1); await page.selectOption('#authorInsertSelect', 'table'); await page.evaluate(() => { const A = window.DitaApp, file = A.state.filesMap.get('a.dita'); A.setFileContent(file, file.current.replace('ABCDEF', 'NEWER')); }); await page.click('#tableInsertForm button[type=submit]'); assert.match(await page.locator('#tableInsertError').textContent(), /变化/); assert.match(await current(), /NEWER/); await page.click('#tableInsertCancel'); await reset();
    await page.setViewportSize({ width: 390, height: 844 }); await select('#plain', 1); await page.selectOption('#authorInsertSelect', 'table'); assert.ok(await page.locator('#tableInsertForm button[type=submit]').isVisible()); assert.ok(await page.locator('#tableCols').isVisible()); await page.click('#tableInsertCancel'); await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await t.test('content settings keep XML fields collapsed and remove duplicate insertion controls', async () => {
    await select('#conditioned', 1); await require('./browser-ui').openProperties(page);
    assert.equal(await page.locator('#inspectorTitle').textContent(), '内容设置'); assert.equal(await page.locator('#inspectorElement').textContent(), '段落');
    assert.equal(await page.locator('#advancedAttributes').evaluate(node => node.open), false); assert.equal(await page.locator('input[data-attribute="product"]').isVisible(), false);
    assert.match(await page.locator('.content-condition').textContent(), /M100/); assert.match(await page.locator('.content-condition').textContent(), /不据此隐藏整段正文/);
    assert.equal(await page.locator('[data-context-action="before"],[data-context-action="after"]').count(), 0);
    await page.click('#advancedAttributes > summary'); await page.fill('input[data-attribute="product"]', 'M200'); await page.locator('input[data-attribute="product"]').press('Tab');
    assert.match(await current(), /id="conditioned" product="M200"/); assert.equal(await page.locator('#advancedAttributes').evaluate(node => node.open), true);
    await page.fill('input[data-attribute="id"]', 'renamed'); await page.locator('input[data-attribute="id"]').press('Tab'); assert.match(await current(), /id="renamed" product="M200"/);
    await undo(); await undo(); assert.equal(await current(), original); await select('#tail', 1); assert.equal(await page.locator('#advancedAttributes').evaluate(node => node.open), false);
    await require('./browser-ui').closePanel(page);
  });
  await t.test('contextual table controls stay available while image deletion only removes the selected image', async () => {
    await select('#params td:first-child', 0); await require('./browser-ui').openProperties(page); assert.equal(await page.locator('#advancedAttributes').evaluate(node => node.open), false); assert.ok(await page.locator('[aria-label="当前列宽"]').isVisible());
    await page.click('[data-context-action="row-after"]'); assert.equal(await page.locator('#params tbody tr').count(), 2); await page.click('[data-context-action="col-after"]'); assert.match(await current(), /cols="3"/); await undo(); await undo(); assert.equal(await current(), original);
    const fixture = original.replace('<entry>A</entry>', '<entry><image id="cellpic" href="assets/one.svg" alt="表内图片"/>A</entry>');
    await page.evaluate(content => { const A = window.DitaApp; A.setFileContent(A.state.filesMap.get('a.dita'), content); }, fixture); await page.locator('#cellpic').click();
    assert.equal(await page.locator('#inspectorElement').textContent(), '图片'); assert.equal(await page.locator('[data-context-action="row-after"]').count(), 0); assert.ok(await page.locator('[data-context-action="edit-resource"]').isVisible());
    await page.click('[data-context-action="remove"]'); assert.equal(await page.locator('#params').count(), 1); assert.equal(await page.locator('#params tbody tr').count(), 1); assert.doesNotMatch(await current(), /id="cellpic"/); await undo(); assert.equal(await current(), fixture); await require('./browser-ui').closePanel(page);
  });
  await t.test('note settings preserve children and delegate footnote models to the existing panel', async () => {
    const fixture = original.replace('<p id="plain">ABCDEF</p>', '<note id="notice" type="warning"><p>段落 <b id="notice-bold">粗体</b></p></note>');
    await page.evaluate(content => { const A = window.DitaApp; A.setFileContent(A.state.filesMap.get('a.dita'), content); }, fixture);
    await page.locator('#notice-bold').click(); await require('./browser-ui').openProperties(page); assert.equal(await page.locator('#inspectorElement').textContent(), '说明');
    await page.selectOption('#contentNoteType', 'tip'); assert.match(await current(), /<note id="notice" type="tip"><p>段落 <b id="notice-bold">粗体<\/b><\/p><\/note>/); await undo(); assert.equal(await current(), fixture);
    await page.locator('#notes [data-dita-source="fn"]').click(); assert.equal(await page.locator('#advancedAttributes').count(), 0); await page.click('[data-context-action="open-notes"]'); assert.ok(await page.locator('#footnotesPanel').isVisible()); await require('./browser-ui').closePanel(page);
  });
  await t.test('content settings remain readonly outside writing and advanced controls fit narrow screens', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await select('#conditioned', 1); await require('./browser-ui').openAdvancedProperties(page);
    const fit = await page.locator('#advancedAttributes').evaluate(node => { const panel = document.getElementById('inspector').getBoundingClientRect(); return Array.from(node.querySelectorAll('input,button')).every(field => field.getBoundingClientRect().right <= panel.right + 1); }); assert.equal(fit, true);
    await require('./browser-ui').closePanel(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.click('#previewButton'); await page.click('#inspectorToggleButton'); assert.equal(await page.locator('#attributesPanel input').count(), 0); await page.click('#visualButton'); await require('./browser-ui').closePanel(page);
  });
  await t.test('Shift+Enter stays in DITA paragraphs, Escape releases Tab, and failed native edits restore the acknowledged view', async () => {
    await select('#plain', 3); await page.keyboard.press('Shift+Enter'); assert.match(await current(), /<p id="plain">ABC<\/p>\s*<p>DEF<\/p>/); await undo(); assert.equal(await current(), original);
    await select('#code', 2); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.id), 'visualEditor');
    await page.evaluate(() => { const host = document.getElementById('visualEditor'); host.insertBefore(document.createElement('h2'), host.firstChild); host.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' })); });
    assert.equal(await current(), original); assert.equal(await page.locator('#visualEditor h2').count(), 1); assert.equal(await page.locator('#visualEditor h2').textContent(), '手册标题');
  });
  await t.test('Map keystrokes target only the current Topic and saving/reopening retains exact content', async () => {
    await open('main.ditamap'); await page.locator('.map-topic-surface #other').waitFor();
    await select('.map-topic-surface #plain', 3); await page.keyboard.press('Enter'); await page.keyboard.insertText('Map正文'); const changed = await current(); assert.match(changed, /Map正文/); assert.equal(await current('b.dita'), other); assert.equal(await current('main.ditamap'), map);
    await undo(); await undo(); assert.equal(await current(), original); await redo(); await redo(); assert.equal(await current(), changed);
    await open('a.dita'); await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty); assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), changed);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await open('a.dita'); assert.equal(await current(), changed); await preserved();
  });
  assert.deepEqual(errors, []);
});
