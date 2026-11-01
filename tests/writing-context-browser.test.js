'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core'), iconv = require('iconv-lite');
test('contextual writing and model note details preserve source and editing context', { timeout: 90000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-numbers-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = {
    'a.dita': '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="a"><title>第一章</title><body><p id="first">A_CMD<fn product="M100">A_INLINE</fn></p><fn id="shared" product="M100">SHARED_TEXT</fn><p>Ref<xref href="#a/shared" type="fn"/> Again<xref href="#a/shared" type="fn"/></p></body></topic>\r\n<?tail preserve?>',
    'b.dita': '<topic id="b"><title>第二章</title><body><p id="second">B_CMD<fn product="M100">B_INLINE</fn><fn conref="resource.dita#r/external"/></p><p><xref href="a.dita#a/shared" type="fn"/></p></body></topic>',
    'resource.dita': '<topic id="r"><title>公共定义</title><body><fn id="external">EXTERNAL_TEXT</fn></body></topic>',
    'scope.dita': '<topic id="scope"><title>条件测试</title><body><p id="scope-paragraph" product="M100">受限正文<fn product="M100">INHERITED</fn></p></body></topic>',
    'c.dita': '<topic id="c"><title>另一手册</title><body><p>C<fn>C_INLINE</fn></p></body></topic>',
    'main.ditamap': '<map><title>功能手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>',
    'other.ditamap': '<map><title>另一功能手册</title><topicref href="c.dita"/></map>'
  };
  for (const [name, source] of Object.entries(original)) await fs.writeFile(path.join(repo, name), iconv.encode(source, name === 'a.dita' ? 'gbk' : 'utf8'));
  await fs.writeFile(path.join(repo, '.dita-project.json'), JSON.stringify({ schema: 1, models: ['M100', 'M200'] }));
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const errors = [];
  async function fresh(subtest) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); subtest.after(() => page.close());
    await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
    await page.selectOption('#mapSelect', 'main.ditamap'); await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface');
    await page.evaluate(() => window.DitaApp.notePresentation.ready()); return page;
  }
  const marker = (page, text) => page.locator('#visualEditor [data-fn-text="' + text + '"]');
  const ready = page => page.evaluate(() => window.DitaApp.notePresentation.ready());
  const cards = page => page.locator('#footnoteList .footnote-number').allTextContents();

  async function select(page, selector, start, end = start) {
    await page.locator(selector).evaluate((node, positions) => {
      node.closest('[contenteditable=true]').focus();
      const range = document.createRange(); range.setStart(node.firstChild, positions.start); range.setEnd(node.firstChild, positions.end);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, { start, end });
    await page.waitForSelector('#authorQuickTools:not([hidden])');
  }
  await t.test('nearby formatting keeps the exact selection and supports undo without editing XML metadata', async subtest => {
    const page = await fresh(subtest);
    await select(page, '#first', 0, 3);
    assert.equal(await page.locator('#authorQuickTools [data-quick-format=b]').isVisible(), true);
    await page.click('#authorQuickTools [data-quick-format=b]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita'].replace('A_CMD', '<b>A_C</b>MD'));
    assert.equal(await page.evaluate(() => getSelection().toString()), 'A_C');
    await page.click('#authorUndoButton'); await ready(page);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita']);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('b.dita').dirty), false);
  });
  await t.test('caret actions open links, tables and footnotes with cancellation preserving source', async subtest => {
    const page = await fresh(subtest);
    await select(page, '#first', 2);
    assert.equal(await page.locator('#authorQuickTools [data-quick-format=b]').isVisible(), false);
    await page.click('#authorQuickTools [data-quick-insert=xref]'); await page.waitForSelector('#resourceDialog[open]'); await page.click('#resourceClose');
    await select(page, '#first', 2); await page.click('#authorQuickTools [data-quick-insert=table]'); await page.waitForSelector('#tableInsertDialog[open]'); await page.click('#tableInsertCancel');
    await select(page, '#first', 2); await page.click('#authorQuickTools [data-quick-insert=fn]'); await page.waitForSelector('#newFootnoteDialog[open]'); await page.click('#newFootnoteCancel');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita']);
    await select(page, '#first', 2); await page.click('#authorQuickTools [data-quick-insert=fn]'); await page.fill('#newFootnoteContent', 'QUICK_NOTE'); await page.check('#newFootnoteModels input[value=M100]'); await page.click('#newFootnoteForm button[type=submit]'); await ready(page);
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), /A_<fn product="M100">QUICK_NOTE<\/fn>CMD/);
    await page.click('#authorUndoButton'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita']);
  });
  await t.test('keyboard access, composition, protected selections and mode changes dismiss tools safely', async subtest => {
    const page = await fresh(subtest);
    await select(page, '#first', 0, 3); await page.keyboard.press('Alt+Slash');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '快捷加粗');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#authorQuickTools').isVisible(), false); assert.equal(await page.evaluate(() => getSelection().toString()), 'A_C');
    await select(page, '#first', 1);
    await page.locator('#first').dispatchEvent('compositionstart'); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    await page.locator('#first').dispatchEvent('compositionend');
    await page.locator('#first').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); node.dispatchEvent(new PointerEvent('pointerup', { bubbles:true })); });
    await page.evaluate(() => new Promise(requestAnimationFrame)); assert.equal(await page.locator('#authorQuickTools').isVisible(), false, 'selection crossing protected fn has no tools');
    await select(page, '#first', 1); await page.evaluate(() => window.DitaApp.setMode('editor')); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    assert.equal(await page.evaluate(() => [...window.DitaApp.state.filesMap.values()].some(f => f.dirty)), false);
  });
  await t.test('single click previews shared content, source and real usage count without dirtying documents', async subtest => {
    const page = await fresh(subtest);
    await page.locator('#visualEditor [data-dita-source=xref]').last().click(); await page.waitForSelector('#footnotePeek:not([hidden])');
    const text = await page.locator('#footnotePeekDetails').innerText(); assert.match(text, /SHARED_TEXT/); assert.match(text, /M100/); assert.match(text, /公共来源：a.dita/); assert.match(text, /当前手册内 3 处使用/); assert.match(text, /其他手册未统计/);
    await page.click('#footnotePeek .note-usage-list summary'); assert.equal(await page.locator('#footnotePeek .note-usage-list li').count(), 3);
    assert.equal(await page.evaluate(() => [...window.DitaApp.state.filesMap.values()].some(f => f.dirty)), false);
    await page.click('#footnotePeekEdit'); await page.waitForSelector('#footnoteEditDialog[open]'); assert.match(await page.locator('#footnoteEditDetails').innerText(), /3 处使用/);
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap', 'a mounted shared source edits in place'); await page.click('#footnoteCancel');
    await page.locator('.map-topic-surface[data-map-topic-path="b.dita"] [data-fn-number="4"]').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]'); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'resource.dita'); await page.click('#footnoteCancel');
    assert.equal(await page.locator('#returnWritingPosition').isVisible(), true); await page.click('#returnWritingPosition'); await page.waitForSelector('.map-topic-surface[data-map-topic-path="b.dita"]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
  });
  await t.test('model selection shows effective intersection and source restrictions live', async subtest => {
    const page = await fresh(subtest); await page.evaluate(() => window.DitaApp.openFile('scope.dita')); await ready(page);
    await marker(page, 'INHERITED').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]');
    assert.equal(await page.locator('#footnoteCommon').isDisabled(), true);
    assert.match(await page.locator('#footnoteScopeSummary').innerText(), /当前清单中适用：M100/);
    await page.uncheck('#footnoteModels input[value=M100]'); await page.check('#footnoteModels input[value=M200]');
    assert.match(await page.locator('#footnoteScopeSummary').innerText(), /没有交集/);
    await page.check('#footnoteModels input[value=M100]'); assert.match(await page.locator('#footnoteScopeSummary').innerText(), /当前清单中适用：M100$/);
    await page.click('#footnoteCancel'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('scope.dita').dirty), false);
  });
  await t.test('mobile popovers fit the viewport and disappear on document switches', async subtest => {
    const page = await fresh(subtest); await page.setViewportSize({ width:390, height:760 });
    await page.evaluate(() => window.DitaApp.openFile('a.dita')); await ready(page);
    await select(page, '#first', 1);
    let bounds = await page.locator('#authorQuickTools').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await marker(page, 'A_INLINE').click(); await page.waitForSelector('#footnotePeek:not([hidden])');
    await page.click('#footnotePeek .note-usage-list summary');
    await page.waitForFunction(() => { const r = document.getElementById('footnotePeek').getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; });
    bounds = await page.locator('#footnotePeek').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 760);
    await page.evaluate(() => window.DitaApp.openFile('c.dita')); await ready(page); assert.equal(await page.locator('#footnotePeek').isVisible(), false); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
  });
  assert.deepEqual(errors, []);
});
