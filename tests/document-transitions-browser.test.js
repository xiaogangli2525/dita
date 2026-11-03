'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core'), iconv = require('iconv-lite');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('document loading, Save As and Map paths preserve current user intent and working buffers', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-transitions-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo); await fs.mkdir(path.join(repo, 'manuals'));
  const docs = Object.fromEntries(['a', 'b', 'c'].map(id => [id, '<topic id="' + id + '"><title>Document ' + id + '</title><body><p id="' + id + 'p">Content ' + id + '</p></body></topic>']));
  const main = '<map><title>First manual</title><topicref href="a.dita"/><topicref href="b.dita"/><topicref href="c.dita"/></map>', nested = '<map><title>Nested manual</title><topicref href="nested-topic.dita"/></map>';
  for (const [name, content] of Object.entries(docs)) await fs.writeFile(path.join(repo, name + '.dita'), content);
  await fs.writeFile(path.join(repo, 'main.ditamap'), main); await fs.writeFile(path.join(repo, 'second.ditamap'), '<map><title>Second manual</title><topicref href="c.dita"/></map>');
  await fs.writeFile(path.join(repo, 'manuals/nested.ditamap'), nested);
  await fs.writeFile(path.join(repo, 'manuals/nested-topic.dita'), '<topic id="nested"><title>Nested</title><body><p>Existing topic</p></body></topic>');
  await fs.writeFile(path.join(repo, 'manuals/new-topic.dita'), '<topic id="new"><title>New nested</title><body><p id="cmd">Reusable</p></body></topic>');
  const illustrated = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="assets"><title>中文图片</title><body><p><image id="illustration" href="diagram.svg" alt="Diagram"/></p><p><xref href="new-topic.dita#new/cmd">Details</xref></p><p conref="new-topic.dita#new/cmd"/><codeblock>  KEEP\r\n    INDENT</codeblock></body></topic>\r\n<?tail keep?>';
  await fs.writeFile(path.join(repo, 'manuals/with-assets.dita'), iconv.encode(illustrated, 'gbk'));
  await fs.writeFile(path.join(repo, 'manuals/diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>');
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(() => resolve(value)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const errors = [];
  async function fresh(subtest) {
    await fs.writeFile(path.join(repo, 'b.dita'), docs.b); await fs.writeFile(path.join(repo, 'main.ditamap'), main); await fs.writeFile(path.join(repo, 'manuals/nested.ditamap'), nested);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), releases = []; page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    subtest.after(async () => { releases.forEach(release => release()); await page.close(); });
    await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root); await page.selectOption('#mapSelect', 'main.ditamap');
    return { page, gate() { const gate = deferred(); releases.push(gate.resolve); return gate; } };
  }
  const current = (page, file) => page.evaluate(file => { const A = window.DitaApp, f = A.state.filesMap.get(file); return { active: A.state.activePath, current: f?.current, disk: f?.disk, dirty: f?.dirty, undo: f?.history?.undo.length || 0 }; }, file);
  const open = (page, file) => page.evaluate(file => window.DitaApp.openFile(file).then(value => Boolean(value)), file);
  async function edit(page, selector, text) { await page.locator(selector).click(); await page.keyboard.press('End'); await page.keyboard.insertText(text); }
  function answer(page, value) { page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept(value) : dialog.accept()); }
  async function saveAs(page) { await page.click('button[data-menu=file]'); await page.locator('#menuPopup').getByRole('menuitem', { name: '另存为', exact: true }).click(); }

  await t.test('duplicate opens issue one read and preserve the new buffer and undo history', async st => {
    const { page, gate } = await fresh(st), held = deferred(), release = gate(); let reads = 0;
    await page.route('**/api/file?path=a.dita', async route => { reads++; const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    await page.locator('.map-node[data-path="a.dita"]').click(); await held.promise; await page.locator('.map-node[data-path="a.dita"]').click(); assert.equal(reads, 1);
    release.resolve(); await page.waitForFunction(() => window.DitaApp.state.activePath === 'a.dita'); await edit(page, '#ap', ' UNSAVED');
    const state = await current(page, 'a.dita'); assert.match(state.current, /UNSAVED/); assert.equal(state.dirty, true); assert.equal(state.undo, 1); assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), docs.a);
  });
  await t.test('a late earlier open cannot steal focus from the last requested document', async st => {
    const { page, gate } = await fresh(st), held = deferred(), release = gate();
    await page.route('**/api/file?path=a.dita', async route => { const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    const first = open(page, 'a.dita'); await held.promise; assert.equal(await open(page, 'b.dita'), true); release.resolve(); assert.equal(await first, false);
    assert.equal((await current(page, 'b.dita')).active, 'b.dita'); await edit(page, '#bp', ' LATEST'); assert.match((await current(page, 'b.dita')).current, /LATEST/);
  });
  await t.test('Map loading and a Topic tab share the same pending file', async st => {
    const { page, gate } = await fresh(st), held = deferred(), release = gate(); let reads = 0;
    await page.route('**/api/file?path=a.dita', async route => { reads++; const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    await open(page, 'main.ditamap'); await held.promise; const topic = open(page, 'a.dita'); release.resolve(); await topic;
    assert.equal(reads, 1); await edit(page, '#ap', ' MAP_AND_TAB'); const state = await current(page, 'a.dita'); assert.match(state.current, /MAP_AND_TAB/); assert.equal(state.undo, 1);
  });
  await t.test('Save As rechecks new target edits before sending an overwrite', async st => {
    const { page, gate } = await fresh(st); await open(page, 'b.dita'); await open(page, 'a.dita'); answer(page, 'b.dita');
    const held = deferred(), release = gate(); let overwrites = 0;
    await page.route('**/api/file', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      if (route.request().postDataJSON().overwrite) { overwrites++; return route.continue(); }
      const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response });
    });
    await saveAs(page); await held.promise; await open(page, 'b.dita'); await edit(page, '#bp', ' UNSAVED_TARGET'); release.resolve();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('目标编辑区已变化'));
    const state = await current(page, 'b.dita'); assert.equal(overwrites, 0); assert.match(state.current, /UNSAVED_TARGET/); assert.equal(state.dirty, true); assert.equal(state.undo, 1); assert.equal(await fs.readFile(path.join(repo, 'b.dita'), 'utf8'), docs.b);
  });
  await t.test('overwrite acknowledgements advance disk without replacing newer text or history', async st => {
    const { page, gate } = await fresh(st); await open(page, 'b.dita'); await open(page, 'a.dita'); answer(page, 'b.dita');
    const held = deferred(), release = gate();
    await page.route('**/api/file', async route => {
      if (route.request().method() !== 'POST' || !route.request().postDataJSON().overwrite) return route.continue();
      const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response });
    });
    await saveAs(page); await held.promise; await open(page, 'b.dita'); await edit(page, '#bp', ' AFTER_WRITE'); const before = await current(page, 'b.dita'); release.resolve();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('已保留目标编辑区'));
    const state = await current(page, 'b.dita'); assert.equal(state.current, before.current); assert.equal(state.disk, docs.a); assert.equal(state.dirty, true); assert.equal(state.undo, before.undo);
    await page.click('#authorUndoButton'); assert.equal((await current(page, 'b.dita')).current, docs.b); await page.click('#authorRedoButton'); await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('b.dita').dirty); assert.equal(await fs.readFile(path.join(repo, 'b.dita'), 'utf8'), before.current);
  });
  await t.test('a completed Save As keeps a later navigation and ignores duplicate submissions', async st => {
    const { page, gate } = await fresh(st); await open(page, 'a.dita'); answer(page, 'background-copy.dita'); const held = deferred(), release = gate(); let writes = 0, prompts = 0;
    page.on('dialog', dialog => { if (dialog.type() === 'prompt') prompts++; });
    await page.route('**/api/file', async route => { if (route.request().method() !== 'POST') return route.continue(); writes++; const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    await saveAs(page); await held.promise; await saveAs(page); assert.equal(prompts, 1); await open(page, 'c.dita'); release.resolve();
    await page.waitForFunction(() => window.DitaApp.state.filesMap.has('background-copy.dita')); assert.equal((await current(page, 'c.dita')).active, 'c.dita'); assert.equal(writes, 1); assert.equal(await fs.readFile(path.join(repo, 'background-copy.dita'), 'utf8'), docs.a);
  });
  await t.test('switching manuals clears node selection and disables structure commands', async st => {
    const { page } = await fresh(st); await page.locator('.map-node[data-path="b.dita"]').click(); await page.waitForFunction(() => window.DitaApp.state.activePath === 'b.dita'); await page.selectOption('#mapSelect', 'second.ditamap');
    assert.equal(await page.evaluate(() => window.DitaApp.state.selectedMapSourcePath), ''); assert.equal(await page.locator('#removeMapButton').isDisabled(), true); assert.equal(await page.locator('#moveMapUpButton').isDisabled(), true); assert.equal(await page.locator('#tree .selected').count(), 0);
  });
  await t.test('a Map operation completed after switching manuals leaves both buffers unchanged', async st => {
    const { page, gate } = await fresh(st); await page.locator('.map-node[data-path="b.dita"]').click(); await page.waitForFunction(() => window.DitaApp.state.activePath === 'b.dita'); const held = deferred(), release = gate();
    await page.route('**/api/map/operation', async route => { const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    const pending = page.evaluate(() => window.DitaApp.maps.applyOperation('moveUp')); await held.promise; await page.selectOption('#mapSelect', 'second.ditamap'); release.resolve(); assert.equal(await pending, null);
    assert.equal((await current(page, 'main.ditamap')).current, main); assert.equal(await fs.readFile(path.join(repo, 'main.ditamap'), 'utf8'), main); assert.equal(await page.evaluate(() => window.DitaApp.state.selectedMap), 'second.ditamap');
  });
  await t.test('nested Maps add a Topic relative to their own directory and save the right href', async st => {
    const { page } = await fresh(st); await page.selectOption('#mapSelect', 'manuals/nested.ditamap'); await page.locator('.map-node[data-path="manuals/nested-topic.dita"]').click(); await page.waitForFunction(() => window.DitaApp.state.activePath === 'manuals/nested-topic.dita'); await page.getByText('目录结构工具', { exact: true }).click(); answer(page, 'new-topic.dita'); await page.click('#addTopicrefButton');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Map 结构已更新')); assert.match((await current(page, 'manuals/nested.ditamap')).current, /href="new-topic.dita"/);
    await page.click('#saveButton'); await page.waitForSelector('#saveScopeDialog[open]'); await page.click('#saveScopeForm button[type=submit]'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('manuals/nested.ditamap').dirty); assert.match(await fs.readFile(path.join(repo, 'manuals/nested.ditamap'), 'utf8'), /href="new-topic.dita"/);
  });
  await t.test('cross-directory Save As retains images, links, conrefs and exact encoded source trivia', async st => {
    const { page } = await fresh(st); await open(page, 'manuals/with-assets.dita'); answer(page, 'copied.dita'); await saveAs(page); await page.waitForFunction(() => window.DitaApp.state.activePath === 'copied.dita'); await page.waitForFunction(() => document.getElementById('illustration')?.naturalWidth === 20);
    const expected = illustrated.replace('href="diagram.svg"', 'href="manuals/diagram.svg"').replace('href="new-topic.dita#new/cmd"', 'href="manuals/new-topic.dita#new/cmd"').replace('conref="new-topic.dita#new/cmd"', 'conref="manuals/new-topic.dita#new/cmd"');
    assert.equal((await current(page, 'copied.dita')).current, expected); assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'copied.dita')), 'gbk'), expected); assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'manuals/with-assets.dita')), 'gbk'), illustrated);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await open(page, 'copied.dita'); await page.waitForFunction(() => document.getElementById('illustration')?.naturalWidth === 20);
  });
  await t.test('a relocated Map is registered, rendered and selectable immediately after Save As', async st => {
    const { page } = await fresh(st); await open(page, 'manuals/nested.ditamap'); answer(page, 'copied.ditamap'); await saveAs(page); await page.waitForFunction(() => window.DitaApp.state.activePath === 'copied.ditamap'); await page.waitForSelector('.map-topic-surface');
    assert.match((await current(page, 'copied.ditamap')).current, /href="manuals\/nested-topic.dita"/); assert.equal(await page.locator('#mapSelect option[value="copied.ditamap"]').count(), 1); assert.match(await page.locator('#visualEditor').textContent(), /Existing topic/);
  });
  await t.test('Save As can rescue an open buffer when its source file was removed externally', async st => {
    const { page } = await fresh(st); await open(page, 'a.dita'); await edit(page, '#ap', ' RESCUED'); const source = (await current(page, 'a.dita')).current; await fs.unlink(path.join(repo, 'a.dita'));
    answer(page, 'recovered.dita'); await saveAs(page); await page.waitForFunction(() => window.DitaApp.state.activePath === 'recovered.dita'); assert.equal(await fs.readFile(path.join(repo, 'recovered.dita'), 'utf8'), source); assert.equal((await current(page, 'a.dita')).current, source);
  });
  await t.test('new-document writes lock their fields, reject duplicate submissions and retain the form after failure', async st => {
    const { page, gate } = await fresh(st), held = deferred(), release = gate(); let writes = 0;
    await require('./browser-ui').newDocument(page);
    await page.fill('#newDocumentTitle', 'HTTP 新章节'); await page.fill('#newDocumentPath', 'create-retry.dita');
    await page.route('**/api/file', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++; if (writes > 1) return route.continue();
      held.resolve(); await release.promise; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary create failure' }) });
    });
    await page.click('#newDocumentSubmit'); await held.promise;
    for (const id of ['newDocumentTemplate', 'newDocumentTitle', 'newDocumentPath', 'newDocumentCancel', 'newDocumentSubmit']) assert.equal(await page.locator('#' + id).isDisabled(), true, id);
    await page.evaluate(() => document.getElementById('newDocumentForm').requestSubmit()); assert.equal(writes, 1);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#newDocumentDialog').isVisible(), true);
    release.resolve(); await page.waitForFunction(() => document.getElementById('newDocumentError').textContent.includes('Temporary create failure'));
    assert.equal(await page.inputValue('#newDocumentTitle'), 'HTTP 新章节'); assert.equal(await page.inputValue('#newDocumentPath'), 'create-retry.dita');
    assert.equal(await page.locator('#newDocumentSubmit').isDisabled(), false);
    await page.click('#newDocumentSubmit'); await page.waitForFunction(() => window.DitaApp.state.activePath === 'create-retry.dita');
    assert.equal(writes, 2); assert.match(await fs.readFile(path.join(repo, 'create-retry.dita'), 'utf8'), /HTTP 新章节/);
  });
  await t.test('workspace replacement closes a pending creation and its late failure cannot alter a new form', async st => {
    const { page, gate } = await fresh(st), held = deferred(), release = gate(), finished = deferred();
    await require('./browser-ui').newDocument(page);
    await page.fill('#newDocumentTitle', '旧请求'); await page.fill('#newDocumentPath', 'old-create.dita');
    await page.route('**/api/file', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      held.resolve(); await release.promise;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Old create failure' }) }); finished.resolve();
    });
    await page.click('#newDocumentSubmit'); await held.promise;
    await page.evaluate(async () => { const A = window.DitaApp, response = await A.api.request('/api/workspace'); await A.workspace.reloadWorkspace(await response.json()); });
    assert.equal(await page.locator('#newDocumentDialog').isVisible(), false);
    await require('./browser-ui').newDocument(page); await page.fill('#newDocumentTitle', '新操作'); await page.fill('#newDocumentPath', 'next-create.dita');
    release.resolve(); await finished.promise; await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#newDocumentDialog').isVisible(), true);
    assert.equal(await page.inputValue('#newDocumentTitle'), '新操作'); assert.equal(await page.locator('#newDocumentError').textContent(), '');
    assert.equal(await page.locator('#newDocumentSubmit').isDisabled(), false);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.has('old-create.dita')), false);
  });
  assert.deepEqual(errors, []);
});
