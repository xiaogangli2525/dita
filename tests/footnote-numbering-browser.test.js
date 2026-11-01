'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core'), iconv = require('iconv-lite');
test('manual footnote numbers share source identity across Author, panel and dialogs', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-numbers-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = {
    'a.dita': '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="a"><title>第一章</title><body><p id="first">A_CMD<fn product="M100">A_INLINE</fn></p><fn id="shared" product="M100">SHARED_TEXT</fn><p>Ref<xref href="#a/shared" type="fn"/> Again<xref href="#a/shared" type="fn"/></p></body></topic>\r\n<?tail preserve?>',
    'b.dita': '<topic id="b"><title>第二章</title><body><p id="second">B_CMD<fn product="M100">B_INLINE</fn><fn conref="resource.dita#r/external"/></p><p><xref href="a.dita#a/shared" type="fn"/></p></body></topic>',
    'resource.dita': '<topic id="r"><title>公共定义</title><body><fn id="external">EXTERNAL_TEXT</fn></body></topic>',
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
  await t.test('second Topic, repeated calls, definition labels, list and dialog share numbers', async subtest => {
    const page = await fresh(subtest);
    assert.equal(await marker(page, 'A_INLINE').innerText(), '[1]'); assert.equal(await marker(page, 'B_INLINE').innerText(), '[3]');
    assert.deepEqual(await page.locator('#visualEditor [data-dita-source=xref]').allTextContents(), ['[2]', '[2]', '[2]']);
    assert.equal(await page.locator('#visualEditor [data-fn-definition]').innerText(), '[定义 2]');
    await page.click('#footnotesButton'); await page.waitForSelector('.footnote-card'); assert.deepEqual(await cards(page), ['1', '2', '3', '4']);
    await page.locator('.footnote-card').filter({ hasText: 'B_INLINE' }).getByRole('button', { name: '编辑注脚', exact: true }).click();
    assert.equal(await page.locator('#footnoteEditHeading').innerText(), '编辑注脚 3'); await page.click('#footnoteCancel');
    await marker(page, 'B_INLINE').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]'); assert.equal(await page.locator('#footnoteEditHeading').innerText(), '编辑注脚 3'); await page.click('#footnoteCancel');
    await page.selectOption('#footnoteModel', 'M200'); assert.deepEqual(await cards(page), ['4'], 'filtering keeps the scope number');
    assert.equal(await marker(page, 'B_INLINE').innerText(), '[3]');
    assert.equal(await page.evaluate(() => [...window.DitaApp.state.filesMap.values()].some(f => f.dirty)), false, 'numbering must not dirty files');
  });
  await t.test('insert/delete and undo/redo renumber later chapters without replacing their DOM or history', async subtest => {
    const page = await fresh(subtest);
    const before = await page.evaluate(() => { const a = window.DitaApp; window.numberingOther = document.querySelector('.map-topic-surface[data-map-topic-path="b.dita"]'); return { source: a.state.filesMap.get('a.dita').current, otherHistory: JSON.stringify(a.state.filesMap.get('b.dita').history) }; });
    await page.locator('#first').evaluate(el => { el.focus(); const range = document.createRange(); range.setStart(el.firstChild, el.firstChild.length); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.click('#newFootnoteButton'); await page.waitForSelector('#newFootnoteDialog[open]'); await page.fill('#newFootnoteContent', 'NEW_FIRST'); await page.check('#newFootnoteModels input[value=M100]'); await page.click('#newFootnoteForm button[type=submit]'); await ready(page);
    assert.equal(await marker(page, 'NEW_FIRST').innerText(), '[1]'); assert.equal(await marker(page, 'B_INLINE').innerText(), '[4]');
    assert.equal(await page.evaluate(() => window.numberingOther.isConnected), true);
    assert.equal(await page.evaluate(() => JSON.stringify(window.DitaApp.state.filesMap.get('b.dita').history)), before.otherHistory);
    assert.equal(await page.evaluate(() => getSelection().anchorNode?.parentElement.closest('.map-topic-surface')?.dataset.mapTopicPath), 'a.dita');
    await page.click('#authorUndoButton'); await ready(page); assert.equal(await marker(page, 'B_INLINE').innerText(), '[3]');
    await page.click('#authorRedoButton'); await ready(page); assert.equal(await marker(page, 'B_INLINE').innerText(), '[4]');
    await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get('a.dita'); a.setFileContent(f, f.current.replace('<fn product="M100">NEW_FIRST</fn>', '')); }); await ready(page);
    assert.equal(await marker(page, 'B_INLINE').innerText(), '[3]'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), before.source);
    await page.click('#authorUndoButton'); await ready(page); assert.equal(await marker(page, 'B_INLINE').innerText(), '[4]');
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), original['a.dita']);
  });
  await t.test('reference edits keep Map numbering when opening their source and preserve original XML on roundtrip', async subtest => {
    const page = await fresh(subtest);
    await page.locator('#visualEditor [data-dita-source=xref]').last().dblclick(); await page.waitForSelector('#footnoteEditDialog[open]');
    assert.equal(await page.locator('#resourceDialog').isVisible(), false);
    assert.equal(await page.locator('#footnoteEditHeading').innerText(), '编辑注脚 2'); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'a.dita');
    await page.fill('#footnoteContent', 'UPDATED_SHARED'); await page.click('#footnoteEditForm button[type=submit]'); await ready(page);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita'].replace('SHARED_TEXT', 'UPDATED_SHARED'));
    await page.evaluate(() => window.DitaApp.openFile('main.ditamap')); await page.waitForSelector('.map-topic-surface'); await ready(page);
    assert.deepEqual(await page.locator('#visualEditor [data-dita-source=xref]').allTextContents(), ['[2]', '[2]', '[2]']);
    const roundtrip = await page.evaluate(() => { const a = window.DitaApp; return [...document.querySelectorAll('.map-topic-surface')].map(surface => { const f = a.state.filesMap.get(surface.dataset.mapTopicPath); return a.ditaCore.updateCurrentFromVisual(null, { visualEditor: surface }, f.current) === f.current; }); });
    assert.deepEqual(roundtrip, [true, true], 'display labels must never become source xref text or attributes');
    await page.locator('.map-topic-surface[data-map-topic-path="b.dita"] [data-dita-source=fn][data-fn-number="4"]').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]');
    assert.equal(await page.locator('#footnoteEditHeading').innerText(), '编辑注脚 4'); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'resource.dita'); await page.click('#footnoteCancel');
    await page.evaluate(() => window.DitaApp.openFile('b.dita')); await ready(page); assert.equal(await marker(page, 'B_INLINE').innerText(), '[3]', 'a chapter keeps its selected manual numbering');
    await page.evaluate(() => window.DitaApp.openFile('c.dita')); await ready(page); assert.equal(await marker(page, 'C_INLINE').innerText(), '[1]', 'a Topic outside the selected manual has its own scope');
  });
  await t.test('invalid references show unknown numbers and switching manuals starts a clean sequence', async subtest => {
    const page = await fresh(subtest); await page.click('#footnotesButton'); await page.waitForSelector('.footnote-card');
    await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get('b.dita'); a.setFileContent(f, f.current.replace('a.dita#a/shared', 'a.dita#a/missing')); });
    await page.waitForFunction(() => document.getElementById('footnotesMessage').textContent.includes('找不到注脚'));
    assert.equal(await page.locator('#visualEditor [data-fn-number]').count(), 0, 'never leave a plausible stale number after a failed projection');
    await page.selectOption('#mapSelect', 'other.ditamap'); await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface[data-map-topic-path="c.dita"]'); await ready(page);
    assert.equal(await marker(page, 'C_INLINE').innerText(), '[1]'); await page.click('#previewButton'); await ready(page); assert.equal(await marker(page, 'C_INLINE').innerText(), '[1]');
    assert.equal(await page.locator('.map-topic-surface').getAttribute('contenteditable'), 'false');
  });
  await t.test('a late snapshot cannot replace the new manual numbering', async subtest => {
    const page = await fresh(subtest); await page.selectOption('#mapSelect', 'other.ditamap'); await page.click('.map-open-author'); await ready(page);
    let release, seen; const gate = new Promise(resolve => { release = resolve; }), observed = new Promise(resolve => { seen = resolve; }); subtest.after(() => release());
    await page.route('**/api/map/resolve', async route => { if (route.request().postDataJSON()?.path === 'main.ditamap') { seen(); await gate; } await route.continue(); });
    await page.selectOption('#mapSelect', 'main.ditamap'); await page.evaluate(() => window.DitaApp.openFile('main.ditamap')); await observed;
    await page.selectOption('#mapSelect', 'other.ditamap'); await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface[data-map-topic-path="c.dita"]'); await ready(page); release();
    await page.unrouteAll({ behavior: 'wait' }); await ready(page); assert.equal(await marker(page, 'C_INLINE').innerText(), '[1]');
    assert.equal(await page.evaluate(() => window.DitaApp.notePresentation.scope), 'other.ditamap');
  });
  await t.test('opening a chapter directly uses its current manual without requiring a Map tab', async subtest => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); subtest.after(() => page.close()); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root); await page.selectOption('#mapSelect', 'main.ditamap');
    await page.click('#tree button[data-path="b.dita"]'); await page.waitForFunction(() => window.DitaApp.state.activePath === 'b.dita'); await ready(page); assert.equal(await marker(page, 'B_INLINE').innerText(), '[3]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.has('main.ditamap')), false);
    await page.click('#footnotesButton'); await page.waitForSelector('.footnote-card'); assert.deepEqual(await cards(page), ['1', '2', '3', '4']);
    await marker(page, 'B_INLINE').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]'); assert.equal(await page.locator('#footnoteEditHeading').innerText(), '编辑注脚 3');
  });
  assert.deepEqual(errors, []);
});
