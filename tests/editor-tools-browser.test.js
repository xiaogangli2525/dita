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
  await fs.mkdir(path.join(repo, 'assets')); await fs.writeFile(path.join(repo, 'assets/diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>');
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
  await t.test('continuous input undoes once and restores exact before/after caret positions', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await select('#plain', '保持这一段', true); const before = await content();
    await page.keyboard.type('abc'); assert.match(await content(), /abc/); await page.keyboard.press('Control+z'); assert.equal(await content(), before);
    assert.equal(await page.evaluate(() => { const r = getSelection().getRangeAt(0), b = document.querySelector('#plain'), p = r.cloneRange(); p.selectNodeContents(b); p.setEnd(r.endContainer, r.endOffset); return p.toString().length; }), 5);
    await page.keyboard.press('Control+y'); assert.equal(await page.evaluate(() => getSelection().anchorOffset), 8);
    await page.keyboard.type('XYZ'); await page.keyboard.press('Control+z'); assert.match(await content(), /abc/); assert.doesNotMatch(await content(), /XYZ/); await page.keyboard.press('Control+z'); assert.equal(await content(), before);
    await page.keyboard.type('AB'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('CD'); await page.keyboard.press('Control+z'); assert.match(await content(), /AB/); assert.doesNotMatch(await content(), /ABCD/); await page.keyboard.press('Control+z'); assert.equal(await content(), before);
  });
  await t.test('one IME composition produces one undo step with no intermediate Latin text', async () => {
    await select('#plain', '保持这一段', true); const before = await content();
    await page.evaluate(() => {
      const surface = document.getElementById('visualEditor'), block = document.getElementById('plain');
      surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); let text;
      for (const value of ['n', 'ni', '你']) {
        surface.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: value, isComposing: true, bubbles: true }));
        if (!text) { text = document.createTextNode(value); block.append(text); } else text.data = value;
        const r = document.createRange(); r.setStart(text, text.length); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r);
        surface.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: value, isComposing: true, bubbles: true }));
      }
      surface.dispatchEvent(new CompositionEvent('compositionend', { data: '你', bubbles: true }));
    });
    await page.waitForTimeout(10); assert.match(await content(), /你/); await page.keyboard.press('Control+z'); assert.equal(await content(), before);
    await page.keyboard.press('Control+y'); assert.match(await content(), /你/); assert.equal(await page.evaluate(() => { const r = getSelection().getRangeAt(0), p = r.cloneRange(); p.selectNodeContents(document.getElementById('plain')); p.setEnd(r.endContainer, r.endOffset); return p.toString().length; }), 6); await page.keyboard.press('Control+z');
    const depth = await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').history.undo.length);
    await page.evaluate(() => {
      const surface = document.getElementById('visualEditor'), block = document.getElementById('plain'), text = document.createTextNode(''); block.append(text);
      surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      for (const value of ['n', '']) {
        surface.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', isComposing: true, bubbles: true })); text.data = value;
        const range = document.createRange(); range.setStart(text, text.length); range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range);
        surface.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, bubbles: true }));
      }
      surface.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    await page.waitForTimeout(10); assert.equal(await content(), before); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').history.undo.length), depth);
  });
  await t.test('Source typing groups preserve the exact textarea selection on undo/redo', async () => {
    await page.click('.editing-tools summary'); await page.click('#sourceButton'); await page.click('.editing-tools summary'); const before = await content();
    const start = await page.locator('#editor').evaluate(el => { const start = el.value.indexOf('保持这一段'); el.focus(); el.setSelectionRange(start, start); return start; });
    await page.keyboard.type('123'); await page.keyboard.press('Control+z'); assert.equal(await content(), before); assert.equal(await page.locator('#editor').evaluate(el => el.selectionStart), start);
    await page.keyboard.press('Control+y'); assert.equal(await page.locator('#editor').evaluate(el => el.selectionStart), start + 3); await page.keyboard.press('Control+z'); await page.click('#visualButton');
  });
  const resource = async kind => {
    if (!await page.locator('#insertElementSelect').isVisible()) await page.click('.editing-tools summary');
    await page.selectOption('#insertElementSelect', kind); await page.click('#insertElementButton'); await page.locator('#resourceDialog[open]').waitFor();
    await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 0);
  };
  await t.test('images insert inside a paragraph at the saved caret and undo/redo retains that position', async () => {
    await select('#plain', '保持', true); const before = await content(); await resource('image'); await page.fill('#resourceLabel', '图示'); await page.click('#resourceForm button[type=submit]');
    assert.match(await content(), /保持<image[^>]+href="assets\/diagram.svg"[^>]*\/>这一段/); await page.keyboard.insertText('接着写'); assert.match(await content(), /\/>接着写这一段/);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); assert.equal(await content(), before); await page.keyboard.press('Control+y');
    await page.keyboard.insertText('继续'); assert.match(await content(), /\/>继续这一段/); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); assert.equal(await content(), before);
  });
  await t.test('links wrap mixed inline selections without losing identifiers; cancel preserves the selection', async () => {
    await select('#mixed', '前置 TCP & 中文'); const before = await content(); await resource('xref'); assert.equal(await page.inputValue('#resourceLabel'), '前置 TCP & 中文'); await page.click('#resourceClose');
    assert.equal(await content(), before); assert.equal(await page.evaluate(() => getSelection().toString()), '前置 TCP & 中文');
    await resource('xref'); await page.selectOption('#resourceTarget', { label: 'b.dita · 另一个 Topic' }); await page.click('#resourceForm button[type=submit]');
    const xml = await content(); assert.match(xml, /<xref href="b.dita#b">前置 <\/xref><i id="em"><xref href="b.dita#b">TCP &amp; 中文<\/xref><\/i>/); await assertPreserved();
    await page.keyboard.press('Control+z'); assert.equal(await content(), before);
  });
  await t.test('Map note list editing uses the shared model picker without opening a separate Topic', async () => {
    await page.click('#projectButton'); await page.fill('#projectModels', 'M100\nM200\nM300'); await page.click('#projectForm button[type=submit]'); await page.waitForFunction(() => !document.getElementById('projectDialog').open);
    await open('main.ditamap'); await page.locator('.map-topic-surface #notes').waitFor(); await page.click('#footnotesButton'); await page.locator('.footnote-card').filter({ hasText: '仅注脚中的文字' }).getByRole('button', { name: '编辑注脚' }).click();
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap'); assert.equal(await page.locator('#footnoteProducts').isVisible(), false);
    const before = await content(); await page.uncheck('#footnoteModels input[value=M100]'); await page.check('#footnoteModels input[value=M200]'); await page.fill('#footnoteContent', '按型号勾选修改'); await page.click('#footnoteEditForm button[type=submit]');
    assert.match(await content(), /<fn product="M200">按型号勾选修改<\/fn>/); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
    await page.click('#authorUndoButton'); assert.equal(await content(), before); await page.click('#authorRedoButton'); assert.match(await content(), /按型号勾选修改/); await page.click('#authorUndoButton');
  });
  await t.test('Map images target the chosen child and stale resource dialogs cannot overwrite newer buffers', async () => {
    await select('.map-topic-surface #same', 'TCP', true); const a = await content(), b = await content('b.dita'); await page.selectOption('#authorInsertSelect', 'image'); await page.locator('#resourceDialog[open]').waitFor(); await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 0); await page.click('#resourceForm button[type=submit]');
    assert.match(await content('b.dita'), /TCP<image[^>]+href="assets\/diagram.svg"[^>]*\/>协议/); assert.equal(await content(), a); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
    await page.keyboard.press('Control+z'); assert.equal(await content('b.dita'), b);
    await select('.map-topic-surface #same', 'TCP', true); await resource('image');
    await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get('b.dita'); a.setFileContent(f, f.current + '<!--newer-->', { render: false }); }); const updated = await content('b.dita');
    await page.click('#resourceForm button[type=submit]'); assert.match(await page.locator('#resourceError').innerText(), /已变化/); assert.equal(await content('b.dita'), updated); await page.click('#resourceClose');
    await page.evaluate(b => window.DitaApp.setFileContent(window.DitaApp.state.filesMap.get('b.dita'), b), b);
  });
  await t.test('existing unknown models can be repaired with chips and inherited notes cannot become common', async () => {
    const before = await content(); await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get('a.dita'); a.setFileContent(f, f.current.replace('</body>', '<p>未知型号<fn product="M1O0">UNKNOWN_MODEL</fn></p><section product="M100"><title>继承条件</title><p>限定<fn product="M100">INHERITED_NOTE</fn></p></section></body>')); });
    await page.locator('.footnote-card').filter({ hasText: 'UNKNOWN_MODEL' }).getByRole('button', { name: '编辑注脚' }).click();
    assert.match(await page.locator('#footnoteModels').innerText(), /M1O0（未登记）/); const invalid = await content(); await page.click('#footnoteEditForm button[type=submit]'); assert.match(await page.locator('#footnoteEditError').innerText(), /未登记/); assert.equal(await content(), invalid);
    await page.uncheck('#footnoteModels input[value=M1O0]'); await page.check('#footnoteModels input[value=M100]'); await page.click('#footnoteEditForm button[type=submit]'); assert.match(await content(), /<fn product="M100">UNKNOWN_MODEL<\/fn>/);
    await page.locator('.footnote-card').filter({ hasText: 'INHERITED_NOTE' }).getByRole('button', { name: '编辑注脚' }).click(); assert.equal(await page.locator('#footnoteCommon').isDisabled(), true); await page.click('#footnoteCancel');
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap'); await page.evaluate(before => window.DitaApp.setFileContent(window.DitaApp.state.filesMap.get('a.dita'), before), before);
  });
  assert.deepEqual(errors, []);
});
