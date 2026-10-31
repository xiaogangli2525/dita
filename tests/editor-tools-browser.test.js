'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core'), iconv = require('iconv-lite');

test('Author selection formatting, body search and block insertion', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-writing-tools-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = '<?xml version="1.0" encoding="GBK"?>\r\n<!--outer--><topic id="a"><title>编写工具验收</title><body>\r\n<p id="mixed" product="M100">前置 <i id="em">TCP &amp; 中文</i> 后置 TCP</p>\r\n<p id="bold" otherprops="keep"><b id="original-bold" product="M100">BOLD MIDDLE TAIL</b></p>\r\n<p id="search" outputclass="ATTRIBUTE_ONLY">重复 TCP<b id="search-bold">协议</b> 与 TCP协议</p>\r\n<p id="plain">保持这一段</p>\r\n<table id="table"><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry id="merged" namest="c1" nameend="c2">合并单元格</entry></row></tbody></tgroup></table>\r\n<p id="notes">注脚前<fn product="M100">TCP协议：仅注脚中的文字</fn>注脚后</p>\r\n<codeblock>AT+OPEN\r\n    KEEP &amp; INDENT</codeblock>\r\n</body></topic>\r\n<?tail keep?>';
  const other = '<topic id="b"><title>另一个 Topic</title><body><p id="same">TCP协议 TCP协议</p><p>保持另一章节</p></body></topic>';
  const map = '<map><title>两章手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>';
  await fs.writeFile(path.join(repo, 'a.dita'), iconv.encode(original, 'gbk')); await fs.writeFile(path.join(repo, 'b.dita'), other); await fs.writeFile(path.join(repo, 'main.ditamap'), map);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' }); git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const content = (file = 'a.dita') => page.evaluate(file => window.DitaApp.state.filesMap.get(file).current, file);
  const open = async file => { await page.click('[data-view=search]'); await page.fill('#workspaceSearchInput', file); await page.locator('.workspace-result').filter({ hasText: file }).click(); await page.waitForFunction(file => window.DitaApp.state.activePath === file, file); };
  const select = async (selector, needle, collapsed = false) => {
    await page.locator(selector).click();
    await page.evaluate(({ selector, needle, collapsed }) => {
      const block = document.querySelector(selector), start = block.textContent.indexOf(needle); if (start < 0) throw Error('selection text not found');
      const point = offset => { const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; } throw Error('invalid selection offset'); };
      const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(start + needle.length)); if (collapsed) range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, { selector, needle, collapsed });
  };
  const closeFind = async () => { if (await page.locator('#editSearchPanel').isVisible()) await page.click('#editFindCloseButton'); };
  const assertPreserved = async () => {
    const xml = await content(); assert.ok(xml.startsWith('<?xml version="1.0" encoding="GBK"?>\r\n<!--outer-->')); assert.ok(xml.endsWith('\r\n<?tail keep?>'));
    assert.match(xml, /<codeblock>AT\+OPEN\r\n    KEEP &amp; INDENT<\/codeblock>/);
    assert.match(xml, /<colspec colname="c1"\/><colspec colname="c2"\/>/); assert.match(xml, /<entry id="merged" namest="c1" nameend="c2">/);
    const ids = await page.evaluate(xml => [...new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('[id]')].map(node => node.id), xml); assert.equal(ids.length, new Set(ids).size);
  };
  await open('a.dita');

  await t.test('format spans inline elements without replacing selected text or losing IDs and source trivia', async () => {
    const before = await content(); await select('#mixed', '前置 TCP & 中文'); await page.click('#authorBoldButton');
    assert.equal(await page.locator('#mixed').textContent(), '前置 TCP & 中文 后置 TCP');
    assert.match(await content(), /<p id="mixed" product="M100"><b>前置 <\/b><i id="em"><b>TCP &amp; 中文<\/b><\/i> 后置 TCP<\/p>/);
    assert.equal(await page.evaluate(() => getSelection().toString()), '前置 TCP & 中文');
    await page.waitForFunction(() => document.getElementById('authorBoldButton').getAttribute('aria-pressed') === 'true');
    await assertPreserved(); const after = await content(); await page.click('#authorUndoButton'); assert.equal(await content(), before); await page.click('#authorRedoButton'); assert.equal(await content(), after); await page.click('#authorUndoButton');
  });
  await t.test('partial unformat preserves the ID and product extent, and keyboard/inline-code toggles retain the selection', async () => {
    await select('#original-bold', 'MIDDLE'); await page.click('#authorBoldButton');
    const xml = await content(); assert.match(xml, /<ph id="original-bold" product="M100"><b>BOLD <\/b>MIDDLE<b> TAIL<\/b><\/ph>/);
    await page.keyboard.press('Control+i'); assert.match(await content(), /<i>MIDDLE<\/i>/);
    await page.click('#authorCodeButton'); assert.match(await content(), /<codeph>MIDDLE<\/codeph>/);
    assert.equal(await page.evaluate(() => getSelection().toString()), 'MIDDLE'); await page.click('#authorCodeButton'); assert.doesNotMatch(await content(), /<codeph>MIDDLE/);
    await assertPreserved();
    for (let i = 0; i < 4; i++) await page.click('#authorUndoButton');
  });
  await t.test('collapsed and protected selections refuse formatting, and Reading remains read-only', async () => {
    await select('#plain', '保持', true); const before = await content(); await page.click('#authorBoldButton'); assert.equal(await content(), before); assert.match(await page.locator('#status').innerText(), /先选中/);
    await select('#notes', '注脚前[1]注脚后'); await page.click('#authorItalicButton'); assert.equal(await content(), before); assert.match(await page.locator('#status').innerText(), /注脚/);
    await page.click('#previewButton'); await page.keyboard.press('Control+b'); assert.equal(await content(), before); await page.click('#visualButton');
  });
  await t.test('paragraph insertion keeps selected text and selects the new placeholder for immediate typing', async () => {
    await select('#plain', '保持这一段'); const before = await content(); await page.selectOption('#authorInsertSelect', 'p');
    assert.equal(await page.evaluate(() => getSelection().toString()), '在此输入内容'); await page.keyboard.insertText('可以直接继续写');
    assert.match(await content(), /<p id="plain">保持这一段<\/p>\r\n<p>可以直接继续写<\/p>/);
    await page.click('#authorUndoButton'); await page.click('#authorUndoButton'); assert.equal(await content(), before);
  });
  await t.test('list and table insertion focus their first editable cells and keep CALS spans', async () => {
    await select('#plain', '保持', true); await page.selectOption('#authorInsertSelect', 'ul'); assert.equal(await page.evaluate(() => getSelection().toString()), '列表项'); await page.keyboard.insertText('第一项');
    assert.match(await content(), /<ul><li>第一项<\/li><li>列表项<\/li><\/ul>/); await page.click('#authorUndoButton'); await page.click('#authorUndoButton');
    await select('#table td', '合并', true); const before = await content(); await page.selectOption('#authorInsertSelect', 'table'); assert.equal(await page.evaluate(() => getSelection().toString()), '单元格'); await page.keyboard.insertText('新参数');
    assert.match(await content(), /<entry>新参数<\/entry><entry>单元格<\/entry>/); await assertPreserved(); await page.click('#authorUndoButton'); await page.click('#authorUndoButton'); assert.equal(await content(), before);
  });
  await t.test('body search finds cross-inline text and literal entities without switching modes or matching attributes/notes', async () => {
    await select('#plain', '保持', true); await page.click('#authorFindButton'); await page.fill('#editFindInput', 'TCP协议');
    assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'visual'); assert.equal(await page.locator('#editFindMeta').innerText(), '1/2');
    await page.click('#editFindNextButton'); assert.equal(await page.evaluate(() => getSelection().toString()), 'TCP协议'); assert.equal(await page.locator('#editFindMeta').innerText(), '2/2');
    await page.fill('#editFindInput', 'ATTRIBUTE_ONLY'); assert.equal(await page.locator('#editFindMeta').innerText(), '未找到');
    await page.fill('#editFindInput', 'TCP & 中文'); assert.equal(await page.locator('#editFindMeta').innerText(), '1/1');
    await closeFind();
  });
  await t.test('replacing all cross-inline matches preserves inline identifiers, escapes XML and is one undo step', async () => {
    const before = await content(); await page.click('#authorFindButton'); await page.fill('#editFindInput', 'TCP协议'); await page.fill('#editReplaceInput', 'HTTP < & 中文'); await page.click('#editReplaceAllButton');
    const xml = await content(); assert.match(xml, /<p id="search" outputclass="ATTRIBUTE_ONLY">重复 HTTP &lt; &amp; 中文<b id="search-bold"><\/b> 与 HTTP &lt; &amp; 中文<\/p>/);
    assert.match(xml, /<fn product="M100">TCP协议：仅注脚中的文字<\/fn>/); await assertPreserved();
    await closeFind(); await page.click('#authorUndoButton'); assert.equal(await content(), before);
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), original);
  });
  await t.test('Map search and insertion use the explicitly selected Topic and keep other chapters mounted', async () => {
    await open('main.ditamap'); await page.locator('.map-topic-surface #same').waitFor();
    await select('.map-topic-surface #same', 'TCP协议', true); const a = await content(), b = await content('b.dita');
    await page.click('#authorFindButton'); assert.equal(await page.inputValue('#editSearchTopic'), 'b.dita'); await page.fill('#editFindInput', 'TCP协议'); await page.fill('#editReplaceInput', 'MQTT协议'); await page.click('#editReplaceAllButton');
    assert.equal(await content(), a); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap'); assert.match(await content('b.dita'), /MQTT协议 MQTT协议/);
    await closeFind(); await page.evaluate(() => { window.keptChapter = document.querySelector('.map-topic-surface[data-map-topic-path="a.dita"]'); }); await page.click('#authorUndoButton'); assert.equal(await content('b.dita'), b); assert.equal(await page.evaluate(() => window.keptChapter.isConnected), true);
    await select('.map-topic-surface #same', 'TCP协议', true); await page.selectOption('#authorInsertSelect', 'ol'); await page.keyboard.insertText('Map 内新步骤'); assert.match(await content('b.dita'), /<ol><li>Map 内新步骤<\/li>/); assert.equal(await content(), a); assert.equal(await content('main.ditamap'), map);
    await page.click('#authorUndoButton'); await page.click('#authorUndoButton');
  });
  await t.test('single replacement advances past replacement text that contains the query', async () => {
    await select('.map-topic-surface #same', 'TCP协议', true); const before = await content('b.dita');
    await page.click('#authorFindButton'); await page.fill('#editFindInput', 'TCP协议'); await page.fill('#editReplaceInput', 'TCP协议1'); await page.click('#editReplaceButton');
    assert.equal(await page.locator('#editFindMeta').innerText(), '2/2'); await page.click('#editReplaceButton');
    assert.match(await content('b.dita'), /TCP协议1 TCP协议1/); assert.doesNotMatch(await content('b.dita'), /TCP协议11/);
    await closeFind(); await page.click('#authorUndoButton'); await page.click('#authorUndoButton'); assert.equal(await content('b.dita'), before);
  });
  await t.test('new section titles are selected, can be formatted, and retain inline formatting after rendering', async () => {
    await select('.map-topic-surface #same', 'TCP协议', true); const before = await content('b.dita'); await page.selectOption('#authorInsertSelect', 'section');
    assert.equal(await page.evaluate(() => getSelection().toString()), '新节标题'); await page.click('#authorBoldButton');
    assert.match(await content('b.dita'), /<section><title><b>新节标题<\/b><\/title><p>新节内容<\/p><\/section>/);
    assert.equal(await page.locator('.map-topic-surface[data-map-topic-path="b.dita"] h3 [data-dita-source="b"]').innerText(), '新节标题');
    await page.click('#authorUndoButton'); await page.click('#authorUndoButton'); assert.equal(await content('b.dita'), before);
  });
  await t.test('source search stays explicit, readonly search disables replacement, and stale surfaces cannot overwrite buffers', async () => {
    await page.click('#previewButton'); await page.keyboard.press('Control+f'); await page.fill('#editFindInput', 'TCP协议'); assert.equal(await page.locator('#editReplaceAllButton').isDisabled(), true); assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'preview');
    await closeFind(); await page.click('#visualButton'); await select('.map-topic-surface #same', 'TCP协议');
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('b.dita'); a.setFileContent(file, file.current.replace('保持另一章节', '后台已修改'), { render: false }); }); const updated = await content('b.dita');
    await page.click('#authorBoldButton'); assert.equal(await content('b.dita'), updated); assert.match(await page.locator('#status').innerText(), /已变化/);
    await open('a.dita'); await page.click('.editing-tools summary'); await page.click('#sourceButton'); await page.click('.editing-tools summary'); await page.keyboard.press('Control+f'); await page.fill('#editFindInput', 'ATTRIBUTE_ONLY'); await page.click('#editFindNextButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'editor'); assert.equal(await page.locator('#editSearchKind').innerText(), 'XML 源码'); assert.match(await page.locator('#editFindMeta').innerText(), /1\/1/); await closeFind(); await page.click('#visualButton');
  });
  await t.test('390px writing/search controls stay contained and explicit GBK save keeps all text', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await select('#plain', '保持这一段'); await page.click('#authorItalicButton'); await page.click('#authorFindButton'); await page.fill('#editFindInput', '保持');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await closeFind();
    const saved = await content(); await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty); assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), saved); await assertPreserved();
  });
  assert.deepEqual(errors, []);
});
