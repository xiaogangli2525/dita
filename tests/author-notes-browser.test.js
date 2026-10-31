'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

test('Author footnotes and writing UI', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-author-notes-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="a"><title>编写验收</title><body><p id="caret">ALPHA <b id="bold">加粗 &amp; 中文</b> OMEGA</p><p id="repeat">SAME SAME SAME</p><section product="M100"><title>型号条件</title><p id="inherit">限定区域</p></section><table id="table"><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry id="cell" namest="c1" nameend="c2">表格参数</entry></row></tbody></tgroup></table><p>已有<fn product="M100">EXISTING</fn><fn>UNKNOWN</fn></p><codeblock>AT+OPEN\r\n  OK</codeblock></body></topic>\r\n<?tail preserve?>';
  const iconv = require('iconv-lite'); await fs.writeFile(path.join(repo, 'a.dita'), iconv.encode(original, 'gbk'));
  const map = '<map><title>功能手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>';
  await fs.writeFile(path.join(repo, 'b.dita'), '<topic id="b"><title>另一章节</title><body><p>这一章节应保持原位。</p></body></topic>');
  await fs.writeFile(path.join(repo, 'main.ditamap'), map);
  await fs.writeFile(path.join(repo, '.dita-project.json'), JSON.stringify({ schema: 1, models: ['M100', 'M200', 'M300'] }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' }); git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server did not start')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`); await page.waitForFunction(() => window.DitaApp?.state.root && window.DitaApp.project.expectedContent !== undefined);
  const open = async file => { await page.click('[data-view=search]'); await page.fill('#workspaceSearchInput', file); await page.locator('.workspace-result').filter({ hasText: file }).click(); await page.waitForFunction(file => window.DitaApp.state.activePath === file, file); };
  const content = () => page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current);
  const caret = async (selector, text, start, length = 0) => {
    await page.locator(selector).click();
    await page.evaluate(({ selector, text, start, length }) => {
      const el = document.querySelector(selector), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) if (node.data.includes(text)) break;
      if (!node) throw new Error('Text node not found');
      const offset = node.data.indexOf(text) + start, range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, { selector, text, start, length });
  };
  const create = async (text, model = 'M100') => {
    await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    await page.fill('#newFootnoteContent', text); if (model) await page.locator('#newFootnoteModels input').filter({ visible: true }).evaluateAll((inputs, model) => { const input = inputs.find(input => input.value === model); if (!input) throw new Error('Model not found'); input.click(); }, model);
    await page.click('#newFootnoteForm button[type=submit]'); await page.waitForFunction(() => !document.getElementById('newFootnoteDialog').open);
  };
  const source = async () => { await page.click('.editing-tools summary'); await page.click('#sourceButton'); await page.click('.editing-tools summary'); };
  await open('a.dita');

  await t.test('opening and cancelling insertion preserves XML, DOM and the saved caret', async () => {
    await caret('#bold', '加粗 & 中文', 2);
    const before = await content(), dom = await page.locator('#visualEditor').innerHTML();
    await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor(); await page.fill('#newFootnoteContent', 'CANCELLED'); await page.click('#newFootnoteCancel');
    assert.equal(await content(), before); assert.equal(await page.locator('#visualEditor').innerHTML(), dom);
    assert.equal(await page.evaluate(() => getSelection().anchorOffset), 2);
    await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => getSelection().anchorOffset), 2); assert.equal(await content(), before);
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), original);
  });
  await t.test('selection insertion preserves repeated text, mixed XML and encoding; undo/redo shares the editor history', async () => {
    const before = await content(); await caret('#repeat', 'SAME SAME SAME', 5, 4); await create('新注脚 < 10 & 中文');
    const after = await content(); assert.equal(after, before.replace('SAME SAME SAME', 'SAME SAME<fn product="M100">新注脚 &lt; 10 &amp; 中文</fn> SAME'));
    assert.doesNotMatch(after, /note-insert-/); assert.equal(await page.locator('#visualEditor [data-fn-text="新注脚 < 10 & 中文"]').count(), 1);
    await page.click('#authorUndoButton'); assert.equal(await content(), before);
    await page.click('#authorRedoButton'); assert.equal(await content(), after);
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), original);
  });
  await t.test('double-click and Enter edit inline notes without leaving the writing surface', async () => {
    await page.locator('#visualEditor [data-fn-text="新注脚 < 10 & 中文"]').dblclick(); await page.locator('#footnoteEditDialog[open]').waitFor();
    await page.fill('#footnoteContent', 'EDITED_IN_AUTHOR'); await page.click('#footnoteEditForm button[type=submit]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'visual'); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'a.dita');
    await page.locator('#visualEditor [data-fn-text="EDITED_IN_AUTHOR"]').focus(); await page.keyboard.press('Enter'); await page.locator('#footnoteEditDialog[open]').waitFor(); await page.click('#footnoteCancel');
    await page.click('#authorUndoButton'); assert.match(await content(), /新注脚 &lt; 10 &amp; 中文/);
  });
  await t.test('table insertion keeps CALS metadata, and inherited scopes cannot be marked common', async () => {
    await caret('#table td', '表格参数', 2); await create('TABLE_NOTE', 'M200');
    assert.match(await content(), /<entry id="cell" namest="c1" nameend="c2">表格<fn product="M200">TABLE_NOTE<\/fn>参数<\/entry>/);
    assert.match(await content(), /<colspec colname="c1"\/><colspec colname="c2"\/>/);
    await caret('#inherit', '限定区域', 4); await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    assert.equal(await page.locator('#newFootnoteCommon').isDisabled(), true); assert.match(await page.locator('#newFootnoteInheritance').innerText(), /M100/); await page.click('#newFootnoteCancel');
  });
  await t.test('Map writing inserts and edits the correct Topic, retains active Map and exports the new inline note', async () => {
    await open('main.ditamap'); await page.locator('.map-topic-surface #caret').waitFor();
    await caret('.map-topic-surface #caret', 'ALPHA', 5); await create('MAP_NOTE');
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('main.ditamap').current), map);
    assert.match(await content(), /ALPHA<fn product="M100">MAP_NOTE<\/fn>/);
    await page.locator('.map-topic-surface [data-fn-text="MAP_NOTE"]').dblclick(); await page.locator('#footnoteEditDialog[open]').waitFor();
    await page.fill('#footnoteContent', 'MAP_NOTE_EDITED'); await page.click('#footnoteEditForm button[type=submit]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
    assert.equal(await page.locator('.map-topic-surface [data-fn-text="MAP_NOTE_EDITED"]').count(), 1);
    await page.evaluate(() => { window.otherSurface = document.querySelector('[data-map-topic-path="b.dita"].map-topic-surface'); });
    await page.click('#authorUndoButton'); assert.match(await content(), />MAP_NOTE<\/fn>/);
    assert.equal(await page.evaluate(() => window.otherSurface.isConnected), true, 'undo keeps other Map chapters mounted');
    assert.equal(await page.evaluate(() => getSelection().anchorNode?.parentElement.closest('.map-topic-surface')?.dataset.mapTopicPath), 'a.dita');
    await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor(); await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', 'html'); await page.click('#modelExportForm [value=preview]');
    await page.frameLocator('#htmlPreviewFrame').locator('.export-footnotes').waitFor(); assert.match(await page.frameLocator('#htmlPreviewFrame').locator('.export-footnotes').innerText(), /MAP_NOTE/);
    await page.click('#closeHtmlPreviewButton');
  });
  await t.test('unresolved scope and the pending-only filter are explicit; model selection is required', async () => {
    await caret('.map-topic-surface #repeat', 'SAME', 4); await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    const before = await content(); await page.fill('#newFootnoteContent', 'UNRESOLVED_NOTE'); await page.click('#newFootnoteForm button[type=submit]');
    assert.match(await page.locator('#newFootnoteError').innerText(), /请选择至少一个型号/); assert.equal(await content(), before);
    await page.check('#newFootnoteForm input[value=unresolved]'); await page.click('#newFootnoteForm button[type=submit]'); await page.waitForFunction(() => !document.getElementById('newFootnoteDialog').open);
    await page.click('#footnotesButton'); await page.selectOption('#footnoteModel', ''); await page.check('#footnoteUnassignedOnly');
    await page.waitForFunction(() => document.getElementById('footnoteList').textContent.includes('UNRESOLVED_NOTE'));
    assert.doesNotMatch(await page.locator('#footnoteList').innerText(), /EXISTING|MAP_NOTE|TABLE_NOTE/);
    await page.uncheck('#footnoteUnassignedOnly');
  });
  await t.test('reading and review disable insertion, and code blocks do not reuse an old caret', async () => {
    await page.click('#previewButton'); assert.equal(await page.locator('#authoringToolbar').isVisible(), false); assert.equal(await page.locator('#panelNewFootnoteButton').isDisabled(), true);
    await page.click('#visualButton'); await caret('.map-topic-surface pre', 'AT+OPEN', 2); const before = await content(); await page.click('#newFootnoteButton');
    assert.equal(await page.locator('#newFootnoteDialog').isVisible(), false); assert.equal(await content(), before);
    await page.click('#reviewButton'); assert.equal(await page.locator('#newFootnoteButton').isVisible(), false); await page.click('#closeReviewButton');
  });
  await t.test('stale dialogs never overwrite new content and mobile creation fits the viewport', async () => {
    await caret('.map-topic-surface #caret', 'OMEGA', 3); await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('a.dita'); a.setFileContent(file, file.current + '<!--external-->'); });
    await page.fill('#newFootnoteContent', 'STALE_NOTE'); await page.check('#newFootnoteModels input[value=M100]'); await page.click('#newFootnoteForm button[type=submit]');
    assert.match(await page.locator('#newFootnoteError').innerText(), /已变化/); assert.doesNotMatch(await content(), /STALE_NOTE/); await page.click('#newFootnoteCancel');
    await open('a.dita'); await page.setViewportSize({ width: 390, height: 844 }); await page.click('#inspectorCloseButton'); await caret('#repeat', 'SAME', 2); await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const rect = await page.locator('#newFootnoteDialog').boundingBox(); assert.ok(rect.width <= 390 && rect.height <= 844);
    await page.click('#newFootnoteCancel');
  });
  await t.test('keyboard insertion can continue writing and composition shortcuts never undo the document', async () => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await caret('#bold', '加粗 & 中文', 2);
    await page.keyboard.press('Control+Alt+n'); await page.locator('#newFootnoteDialog[open]').waitFor();
    await page.fill('#newFootnoteContent', 'CONTINUOUS_NOTE'); await page.check('#newFootnoteModels input[value=M300]'); await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !document.getElementById('newFootnoteDialog').open);
    await page.keyboard.insertText('继续编写');
    assert.match(await content(), /<b id="bold">加粗<fn product="M300">CONTINUOUS_NOTE<\/fn>继续编写 &amp; 中文<\/b>/);
    const before = await content();
    const intercepted = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
      document.activeElement.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(intercepted, false); assert.equal(await content(), before);
    const scroll = await page.locator('#visualEditor').evaluate(el => el.scrollTop);
    await page.click('#authorUndoButton'); assert.equal(await page.locator('#visualEditor').evaluate(el => el.scrollTop), scroll);
    assert.equal(await page.evaluate(() => document.getElementById('visualEditor').contains(getSelection().anchorNode)), true);
    await page.click('#authorRedoButton'); assert.equal(await content(), before);
  });
  await t.test('panel insertion confirms common scope, supports repeated insertion, and saves GBK explicitly', async () => {
    await caret('#repeat', 'SAME', 2); await page.click('#footnotesButton'); await page.click('#panelNewFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    await page.fill('#newFootnoteContent', '所有型号通用'); await page.check('#newFootnoteCommon'); await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !document.getElementById('newFootnoteDialog').open);
    await create('紧接上一注脚', 'M200');
    assert.match(await content(), /SA<fn otherprops="applicability\(common\)">所有型号通用<\/fn><fn product="M200">紧接上一注脚<\/fn>ME/);
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), original);
    const saved = await content(); await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty);
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), saved);
    assert.ok(saved.startsWith('<?xml version="1.0" encoding="GBK"?>\r\n<!--keep-->'));
    assert.match(saved, /<codeblock>AT\+OPEN\r\n  OK<\/codeblock>/);
    assert.equal(await page.evaluate(() => { const e = document.getElementById('footnoteList'); return e.clientHeight > 100 && getComputedStyle(e).overflowY === 'auto'; }), true);
  });
  await t.test('paragraph splitting keeps XML identifiers unique and remains undoable', async () => {
    await caret('#bold', '加粗', 1); const before = await content();
    await page.keyboard.press('Enter'); await page.keyboard.insertText('下一段');
    const ids = await page.evaluate(() => [...new DOMParser().parseFromString(window.DitaApp.state.filesMap.get('a.dita').current, 'application/xml').querySelectorAll('[id]')].map(e => e.getAttribute('id')));
    assert.equal(ids.length, new Set(ids).size, 'Enter must not clone paragraph/inline identifiers');
    assert.match(await content(), /下一段/);
    await page.click('#authorUndoButton'); await page.click('#authorUndoButton'); assert.equal(await content(), before);
  });
  await t.test('without a registry, a new Topic offers known models and accepts explicit new model names', async () => {
    await page.click('#projectButton'); await page.fill('#projectModels', ''); await page.click('#projectForm button[type=submit]');
    await page.waitForFunction(() => !document.getElementById('projectDialog').open);
    await open('b.dita'); await caret('#visualEditor p', '这一章节应保持原位。', 3); await page.click('#newFootnoteButton'); await page.locator('#newFootnoteDialog[open]').waitFor();
    assert.equal(await page.locator('#newFootnoteCustomModels').isVisible(), true);
    assert.equal(await page.locator('#newFootnoteModels input[value=M100]').count(), 1);
    await page.fill('#newFootnoteContent', '新型号的说明'); await page.fill('#newFootnoteProductInput', 'M400 M500'); await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !document.getElementById('newFootnoteDialog').open);
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('b.dita').current), /<fn product="M400 M500">新型号的说明<\/fn>/);
  });
  assert.deepEqual(errors, []);
});
