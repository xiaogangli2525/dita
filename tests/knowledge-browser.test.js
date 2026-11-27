'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto'), { chromium } = require('playwright-core'), { unzipSync, strFromU8 } = require('fflate');
const { collectDemoFiles } = require('../scripts/demo-workspace');
const { measureFiles } = require('../public/knowledge/knowledge-zip');
const { renderPage } = require('../public/knowledge/knowledge-reader');
const { createSearchEngine } = require('../public/knowledge/knowledge-search');
test('reader retains anchor DOM, defers IME searches and ignores stale lazy manual loads', async t => {
  const manuals = ['111111111111', '222222222222'].map((id, i) => ({
    id: 'm-' + id, title: '手册' + i, source: {}, toc: [{ anchor: 'a' + i, title: 'UART' }, { anchor: 'b' + i, title: '结束' }],
    entries: [{ anchor: 'a' + i, title: 'UART', text: 'UART 串口说明' }],
    body: `<h2 id="a${i}">UART</h2><p><a href="#b${i}">跳转</a></p><pre>UART example</pre><table><tr><td>4</td></tr></table><h2 id="b${i}">结束</h2>`
  }));
  const book = { schema: 1, title: 'KB', model: 'M', sdkVersion: 'v1', generatedAt: '2026-01-01', manuals };
  book.index = createSearchEngine().build(manuals.flatMap(m => m.entries.map(e => ({ ...e, manualId: m.id, manualTitle: m.title }))));
  const browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-performance-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const file = path.join(temporary, 'index.html'); await fs.writeFile(file, renderPage(book));
  await page.goto(pathToFileURL(file).href);
  await page.locator('.manual-card').first().click(); await page.locator('#kbArticle pre').waitFor();
  await page.evaluate(() => { window.savedPre = document.querySelector('#kbArticle pre'); });
  await page.locator('#kbArticle a').click();
  await page.waitForFunction(() => location.hash.includes('b0'));
  assert.equal(await page.evaluate(() => window.savedPre === document.querySelector('#kbArticle pre')), true);
  assert.equal(await page.locator('#kbArticle .code-frame').count(), 1);
  assert.equal(await page.locator('#kbArticle .table-scroll').count(), 1);
  await page.locator('#kbHomeButton').click(); await page.locator('.manual-card').first().click();
  assert.equal(await page.evaluate(() => window.savedPre === document.querySelector('#kbArticle pre')), true);
  assert.equal(await page.locator('#kbArticleToc button').count(), 2);
  await page.locator('#kbSearch').focus();
  await page.evaluate(() => {
    const field = document.getElementById('kbSearch');
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); field.value = 'chuan';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true }));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#kbResults').isHidden(), true);
  assert.equal(await page.locator('#kbSuggestions').isHidden(), true);
  await page.evaluate(() => {
    const field = document.getElementById('kbSearch'); field.value = 'UART';
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await page.locator('#kbResultList .search-result').first().waitFor();
  await page.locator('#kbResultList .search-result').first().click();
  await page.locator('#kbArticle mark').first().waitFor();
  assert.equal(await page.evaluate(() => window.savedPre === document.querySelector('#kbArticle pre')), false);
  const lazy = structuredClone(book); lazy.manuals.forEach(manual => delete manual.body);
  const requests = [], waiting = [];
  await page.route('http://reader.test/**', async route => {
    const request = route.request().url();
    if (request.endsWith('/')) { await route.fulfill({ contentType: 'text/html', body: renderPage(lazy, { localSemantic: true }) }); return; }
    requests.push(request);
    const manual = manuals.find(m => request.endsWith(m.id + '.html'));
    if (manual.id === manuals[0].id) await new Promise(resolve => waiting.push(resolve));
    await route.fulfill({ contentType: 'text/html', body: manual.body });
  });
  await page.goto('http://reader.test/');
  await page.locator('.manual-card').first().click();
  await page.waitForFunction(() => document.getElementById('kbArticle').textContent.includes('正在加载'));
  await page.locator('[data-kb-manual="' + manuals[1].id + '"]').evaluate(button => button.click());
  await page.locator('#a1').waitFor();
  for (const resolve of waiting) resolve();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#a0').count(), 0);
  await page.locator('[data-kb-manual="' + manuals[0].id + '"]').evaluate(button => button.click());
  await page.locator('#a0').waitFor();
  assert.equal(requests.length, 2);
  assert.deepEqual(errors, []);
});
const hash = value => createHash('sha256').update(value).digest('hex');
test('real HTTP knowledge delivery works across repositories and from a moved offline folder', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-knowledge-')), http = path.join(temporary, 'HTTP真实文档库'), extra = path.join(temporary, '独立测试库');
  const mapPath = 'http_httpsusermanual.ditamap', original = collectDemoFiles(path.join(__dirname, '../examples/http_httpsusermanual'), mapPath);
  for (const [name, bytes] of original) { await fs.mkdir(path.dirname(path.join(http, name)), { recursive: true }); await fs.writeFile(path.join(http, name), bytes); }
  await fs.mkdir(path.join(extra, 'topics'), { recursive: true });
  const extraPath = 'topics/r_https_example.dita', extraSource = '<topic id="same"><title>独立功能验收</title><body><p>AT+KBTEST_G 582 ONLY_G_BODY<fn product="ML307G">ONLY_G_NOTE</fn><fn product="ML307N">ONLY_N_PRIVATE_NOTE</fn></p><p product="ML307N">ONLY_N_PRIVATE_BODY<ph audience="internal"><?oxy_insert_start?>INTERNAL_UNPAIRED_REVISION</ph></p><codeblock>AT+KBTEST_G\nOK</codeblock></body></topic>';
  await fs.writeFile(path.join(extra, extraPath), extraSource); await fs.writeFile(path.join(extra, 'extra.ditamap'), '<map><title>独立功能验收</title><topicref href="' + extraPath + '"/></map>');
  await fs.writeFile(path.join(extra, '.dita-project.json'), JSON.stringify({ schema: 1, models: ['ML307G', 'ML307N'] }));
  const excludeInternal = '<prop att="audience" val="internal" action="exclude"/>';
  await fs.writeFile(path.join(extra, 'exclude-internal.ditaval'), '<val>' + excludeInternal + '</val>');
  await fs.writeFile(path.join(extra, 'ml307g.ditaval'), '<val>' + excludeInternal + '<prop att="product" val="ML307N" action="exclude"/></val>');
  for (const repo of [http, extra]) for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Acceptance', '-c', 'user.email=acceptance@example.invalid', 'commit', '-qm', 'Acceptance copy']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['branch', 'alternate'], { cwd: http });
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const n = server.address().port; server.close(() => resolve(n)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: http, REPOSITORIES_ROOT: temporary, PORT: String(port), DITA_SEMANTIC_CACHE_DIR: path.join(temporary, 'vector-cache'), DITA_AI_CONFIG_FILE: path.join(temporary, 'ai.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1020 } }), errors = [];
  const context = page.context();
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  await page.evaluate(mapPath => window.DitaApp.openFile(mapPath), mapPath);
  await t.test('indexed chapter text and blocks omit deleted revision values while the reader keeps the marks', async () => {
    const manual = await page.evaluate(() => window.DitaKnowledgeDocument.extractManual(
      '<h2 id="sec-1">外设资源</h2>\n<p>UART*<del class="oxy-delete">2</del><ins class="oxy-insert">4</ins></p>',
      'm-0123456789abcdef'));
    assert.equal(manual.entries[0].text, '外设资源 UART*4');
    assert.ok(manual.entries[0].structure.units.some(unit => unit.text === 'UART*4'));
    assert.match(manual.body, /<del class="oxy-delete">2<\/del><ins class="oxy-insert">4<\/ins>/);
  });
  async function addCurrent() {
    await page.click('#knowledgeAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled && (document.getElementById('knowledgeStatus').textContent.includes('已加入') || document.getElementById('knowledgeError').textContent), null, { timeout: 60000 });
    assert.equal(await page.locator('#knowledgeError').innerText(), '');
  }
  async function download() {
    const semanticExport = await page.locator('#knowledgeSemantic').isChecked();
    const waiting = page.waitForEvent('download', { timeout: semanticExport ? 120000 : 15000 }); await page.click('#knowledgeDownload');
    const result = await waiting; return { filename: result.suggestedFilename(), bytes: await fs.readFile(await result.path()) };
  }
  async function stage(name, action) { let passed = false; await t.test(name, async () => { await action(); passed = true; }); assert.ok(passed, 'Stop after failed knowledge workflow: ' + name); }
  await stage('HTTP capture uses explicit model/profile policies and preview matches the offline reader', async () => {
    await page.click('#knowledgeButton'); await page.fill('#knowledgeTitle', 'ML307G 开发者知识库'); await page.fill('#knowledgeModel', 'ML307G'); await page.fill('#knowledgeSdk', '预览版');
    await page.locator('#knowledgeFilter option[value="filters/filter_tbd.ditaval"]').waitFor({ state: 'attached' });
    await page.selectOption('#knowledgeFilter', 'filters/filter_tbd.ditaval'); await page.check('#knowledgePrefixes'); await page.selectOption('#knowledgeMode', 'AT'); await page.fill('#knowledgeModule', 'HTTP'); await page.fill('#knowledgeVersion', 'HTTP真实手册');
    await addCurrent(); assert.equal(await page.locator('.knowledge-part').count(), 1); assert.equal(await page.locator('#knowledgeModel').isDisabled(), true);
    await page.click('#knowledgePreview'); const frame = page.frameLocator('#knowledgePreviewFrame'); await frame.locator('#kbManualCards .manual-card').waitFor();
    await frame.locator('#kbSearch').fill('AT+MHTTPCFG'); await frame.locator('#kbSearch').press('Enter');
    assert.match(await frame.locator('#kbResultList .search-result').first().innerText(), /AT\+MHTTPCFG/);
    await frame.locator('#kbResultList .search-result').first().click(); await frame.locator('#kbArticle table').first().waitFor();
    assert.match(await frame.locator('#kbArticle').innerText(), /AT\+MHTTPCFG/);
    assert.ok(await frame.locator('#kbArticle mark').count() > 0);
    assert.equal(await frame.locator('#kbArticle .export-footnotes > ol > li').count(), 25);
    await page.click('#knowledgePreviewClose'); await page.click('#knowledgeClose');
  });
  await stage('closing during filter loading cannot erase remembered publication conditions on a workspace change', async () => {
    const initial = await page.evaluate(() => window.DitaApp.state.currentBranch), endpoint = '**/api/filters'; let release;
    const hold = new Promise(resolve => { release = resolve; });
    await context.route(endpoint, async route => { await hold; await route.continue().catch(() => {}); });
    const pending = context.waitForEvent('request', request => request.url().endsWith('/api/filters'));
    await page.click('#knowledgeButton'); await pending;
    assert.equal(await page.locator('#knowledgePreview').isDisabled(), true);
    assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    await page.click('#knowledgeClose'); release(); await context.unroute(endpoint);
    await page.selectOption('#branchSelect', 'alternate'); await page.waitForFunction(() => window.DitaApp.state.currentBranch === 'alternate');
    await page.selectOption('#branchSelect', initial); await page.waitForFunction(initial => window.DitaApp.state.currentBranch === initial, initial);
    await page.click('#knowledgeButton'); await page.locator('#knowledgeAdd:not([disabled])').waitFor();
    assert.equal(await page.locator('#knowledgeFilter').inputValue(), 'filters/filter_tbd.ditaval');
    assert.equal(await page.locator('#knowledgePrefixes').isChecked(), true);
    await page.click('#knowledgeClose');
  });
  await stage('oversized semantic delivery stops before inference and the captured HTTP manual remains usable', async () => {
    await page.click('#knowledgeButton'); await page.check('#knowledgeSemantic');
    const endpoint = '**/api/knowledge/publish', requests = [], downloads = [];
    const requested = request => { if (request.url().endsWith('/api/knowledge/publish')) requests.push(request.url()); };
    const downloaded = download => downloads.push(download);
    context.on('request', requested); page.on('download', downloaded);
    const profile = await page.evaluate(() => window.DitaKnowledgeSemantic.PROFILE);
    await context.route(endpoint, route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'estimate', profile, chunks: 12000, bytes: 64 * 1024 * 1024 }) + '\n' }));
    try {
      await page.click('#knowledgeDownload'); await page.waitForFunction(() => document.getElementById('knowledgeError').textContent.includes('64 MiB'));
      assert.equal(requests.length, 1); assert.equal(downloads.length, 0);
      assert.match(await page.locator('#knowledgeCapacity').innerText(), /MiB/);
      assert.equal(await page.locator('.knowledge-part').count(), 1);
    } finally { await context.unroute(endpoint); context.removeListener('request', requested); page.removeListener('download', downloaded); }
    await page.uncheck('#knowledgeSemantic'); await page.click('#knowledgePreview');
    await page.frameLocator('#knowledgePreviewFrame').locator('#kbManualCards .manual-card').waitFor();
    assert.equal(await page.locator('#knowledgeError').innerText(), '');
    await page.click('#knowledgePreviewClose'); await page.click('#knowledgeClose');
  });
  await stage('cancelling a starting Worker prevents a late preview and allows a fresh publication', async () => {
    await page.click('#knowledgeButton');
    const endpoint = '**/knowledge-publish-worker.js'; let release;
    const hold = new Promise(resolve => { release = resolve; });
    await context.route(endpoint, async route => { await hold; await route.abort().catch(() => {}); });
    const pending = context.waitForEvent('request', request => request.url().endsWith('/knowledge/knowledge-publish-worker.js'));
    await page.click('#knowledgePreview'); await pending;
    assert.equal(await page.locator('#knowledgeBatchCancel').innerText(), '取消发布');
    await page.click('#knowledgeBatchCancel'); release(); await context.unroute(endpoint);
    assert.equal(await page.locator('#knowledgePreviewDialog').evaluate(node => node.open), false);
    assert.match(await page.locator('#knowledgeStatus').innerText(), /手册来源仍可用于重新导出/);
    await page.click('#knowledgePreview'); await page.frameLocator('#knowledgePreviewFrame').locator('#kbManualCards .manual-card').waitFor();
    assert.equal(await page.locator('#knowledgeError').innerText(), '');
    await page.click('#knowledgePreviewClose'); await page.click('#knowledgeClose');
  });
  if (process.env.BLINK_MODELS) await stage('structured chunk preview preserves parameter notes, source positioning and the legacy comparison', async () => {
    await page.click('#knowledgeButton'); await page.click('#knowledgeChunkPreview');
    const choice = await page.locator('#knowledgeChunksEntry option').evaluateAll(options => options.find(option => option.textContent.includes('AT+MHTTPCFG'))?.value);
    assert.ok(choice); await page.selectOption('#knowledgeChunksEntry', choice);
    await page.locator('#knowledgeChunksGenerate:not([disabled])').waitFor({ timeout: 60000 });
    assert.match(await page.locator('#knowledgeChunksSummary').innerText(), /结构块/);
    assert.ok(await page.locator('.knowledge-chunk').count() > 5);
    const values = await page.locator('.knowledge-chunk-heading>span').allTextContents(); assert.ok(values.every(value => parseInt(value) <= 512));
    const noted = page.locator('.knowledge-chunk').filter({ has: page.locator('.knowledge-chunk-footer>span').filter({ hasText: /^[1-9]/ }) }).first();
    await noted.locator('button').click();
    const source = page.frameLocator('#knowledgeChunksSource'); await source.locator('[data-chunk-active]').waitFor();
    assert.ok((await noted.locator('pre').innerText()).includes('注脚：'));
    if (process.env.DITA_STRUCTURE_SCREENSHOT) await page.screenshot({ path: process.env.DITA_STRUCTURE_SCREENSHOT, fullPage: true });
    await page.selectOption('#knowledgeChunksStrategy', 'legacy'); await page.locator('#knowledgeChunksGenerate:not([disabled])').waitFor({ timeout: 60000 });
    assert.match(await page.locator('#knowledgeChunksSummary').innerText(), /旧版长度分片/);
    await page.selectOption('#knowledgeChunksStrategy', 'structure'); await page.locator('#knowledgeChunksGenerate:not([disabled])').waitFor({ timeout: 60000 });
    await page.setViewportSize({ width: 620, height: 850 });
    assert.ok(await page.locator('#knowledgeChunksDialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.setViewportSize({ width: 1440, height: 1020 });
    const endpoint = '**/api/knowledge/chunks'; let release;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route(endpoint, async route => { await hold; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'LATE_PREVIEW_ERROR' }) }).catch(() => {}); });
    const pending = page.waitForRequest(request => request.url().endsWith('/api/knowledge/chunks'));
    await page.click('#knowledgeChunksGenerate'); await pending; await page.click('#knowledgeChunksClose'); release(); await page.unroute(endpoint);
    await page.click('#knowledgeChunkPreview'); await page.locator('#knowledgeChunksGenerate:not([disabled])').waitFor({ timeout: 60000 });
    assert.doesNotMatch(await page.locator('#knowledgeChunksSummary').innerText(), /LATE_PREVIEW_ERROR/);
    await page.click('#knowledgeChunksClose'); await page.click('#knowledgeClose');
  });
  if (process.env.BLINK_MODELS) await stage('the normal export entry produces a content-bound offline semantic index', async () => {
    await page.click('#knowledgeButton'); await page.check('#knowledgeSemantic');
    const firstStarted = Date.now(), result = await download(), firstMs = Date.now() - firstStarted, archive = unzipSync(new Uint8Array(result.bytes));
    const book = JSON.parse(strFromU8(archive['docs/knowledge.json']));
    const { flatten, bookFromPath } = require('../lib/knowledge-book'), { validate } = require('../public/knowledge/knowledge-semantic');
    const storedBytes = measureFiles(Object.entries(archive).map(([name, content]) => ({ name, content })));
    assert.ok(result.bytes.length < storedBytes);
    const cliZip = path.join(temporary, 'real-http-semantic.zip');
    await fs.writeFile(cliZip, result.bytes);
    assert.deepEqual(bookFromPath(cliZip), book);
    assert.ok(book.semantic.chunks.length > 24);
    assert.equal(validate(flatten(book), book.semantic).length, book.semantic.chunks.length * 512);
    const manifest = JSON.parse(strFromU8(archive['docs/manifest.json']));
    assert.equal(manifest.semantic.profile.id, 'bge-small-zh-int8-cls-v3');
    assert.ok(book.manuals.every(manual => manual.entries.every(entry => entry.structure?.units.length)));
    const configuration = book.manuals[0].entries.find(entry => entry.title.includes('AT+MHTTPCFG'));
    assert.ok(configuration.structure.units.some(unit => unit.text.includes('非缓存模式') && unit.context.some(value => value.includes('<cached>'))), 'real DITA enumeration must retain its parameter definition');
    if (process.env.DITA_STRUCTURE_ACCEPTANCE_OUTPUT) { await fs.mkdir(process.env.DITA_STRUCTURE_ACCEPTANCE_OUTPUT, { recursive: true }); await fs.writeFile(path.join(process.env.DITA_STRUCTURE_ACCEPTANCE_OUTPUT, 'HTTP-structured-knowledge.zip'), result.bytes); }
    assert.match(await page.locator('#knowledgeVectorStatus').innerText(), /复用 0 份，重新生成 1 份/);
    const cachedStarted = Date.now(), cached = await download(), cachedMs = Date.now() - cachedStarted;
    assert.match(await page.locator('#knowledgeVectorStatus').innerText(), /复用 1 份，重新生成 0 份/);
    const cachedBook = JSON.parse(strFromU8(unzipSync(new Uint8Array(cached.bytes))['docs/knowledge.json']));
    assert.deepEqual(cachedBook.semantic, book.semantic);
    t.diagnostic('Real HTTP vector export: first=' + firstMs + 'ms; cached=' + cachedMs + 'ms; chunks=' + book.semantic.chunks.length +
      '; ZIP before compression=' + storedBytes + ' bytes; ZIP downloaded=' + result.bytes.length + ' bytes');
    await page.locator('.knowledge-vector-options summary').click();
    await page.check('#knowledgeCompact');
    const compact = await download(), compactArchive = unzipSync(new Uint8Array(compact.bytes));
    const compactBook = JSON.parse(strFromU8(compactArchive['docs/knowledge.json']));
    assert.equal(compactBook.semantic.schema, 2);
    assert.equal(compactBook.semantic.profile.id, book.semantic.profile.id);
    assert.equal(validate(flatten(compactBook), compactBook.semantic).length, book.semantic.chunks.length * 512);
    assert.deepEqual(compactBook.semantic.chunks, book.semantic.chunks);
    assert.deepEqual(compactArchive['docs/index.html'], archive['docs/index.html']);
    assert.ok(compact.bytes.length < cached.bytes.length);
    assert.match(await page.locator('#knowledgeVectorStatus').innerText(), /复用 1 份，重新生成 0 份.*Int8/);
    const compactPath = path.join(temporary, 'real-http-int8.zip');
    await fs.writeFile(compactPath, compact.bytes);
    const info = JSON.parse(execFileSync(process.execPath, ['bin/blink-cli.js', '--kb', compactPath, '--info', '--json'], { encoding: 'utf8' }));
    assert.equal(info.semantic.vectorEncoding, 'int8');
    const resultFor = file => JSON.parse(execFileSync(process.execPath, ['bin/blink-cli.js', '--kb', file, '--search', 'semantic', '如何配置请求超时时间', '--json'], { encoding: 'utf8' })).results[0].id;
    assert.equal(resultFor(cliZip), resultFor(compactPath));
    const extracted = path.join(temporary, 'local-reader');
    await fs.mkdir(extracted);
    for (const name of ['index.html', 'knowledge.json']) await fs.writeFile(path.join(extracted, name), compactArchive['docs/' + name]);
    const { startReader } = require('../lib/knowledge-reader-server');
    const reader = await startReader(extracted), localPage = await browser.newPage();
    try {
      const remote = await fetch(reader.url + '/search', { method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ query: 'HTTP' }) });
      assert.equal(remote.status, 403);
      assert.doesNotMatch(strFromU8(compactArchive['docs/index.html']), /id="kbLocalSemantic"/);
      await localPage.goto(reader.url);
      assert.equal(await localPage.locator('#kbLocalSemantic').isChecked(), true);
      await localPage.fill('#kbSearch', '如何配置请求超时时间');
      await localPage.press('#kbSearch', 'Enter');
      await localPage.waitForFunction(() => document.getElementById('kbSearchMeta').textContent.includes('本机混合搜索'), null, { timeout: 60000 });
      const first = localPage.locator('#kbResultList .search-result').first();
      assert.match(await first.innerText(), /AT\+MHTTPCFG/);
      await first.click(); await localPage.locator('#kbBack').click();
      assert.match(await localPage.locator('#kbSearchMeta').innerText(), /本机混合搜索/);
      await localPage.fill('#kbSearch', 'AT+MHTTPCFG');
      await localPage.press('#kbSearch', 'Enter');
      await localPage.waitForFunction(() => document.getElementById('kbSearchMeta').textContent.includes('关键词精确检索'));
      await first.click(); await localPage.locator('#kbBack').click();
      assert.match(await localPage.locator('#kbSearchMeta').innerText(), /关键词精确检索/);
      const exact = execFileSync(process.execPath, ['bin/blink-cli.js', '--kb', compactPath, '--search', 'semantic', 'AT+MHTTPCFG', '--json'], { encoding: 'utf8' });
      assert.equal(JSON.parse(exact).searchMode, 'lexical');
    } finally {
      await localPage.close();
      await new Promise(resolve => reader.server.close(resolve));
    }
    t.diagnostic('Real HTTP Int8 ZIP: Float32=' + cached.bytes.length + ' bytes; Int8=' + compact.bytes.length + ' bytes');
    await page.uncheck('#knowledgeCompact');
    await page.check('#knowledgeRebuild');
    await download(); assert.match(await page.locator('#knowledgeVectorStatus').innerText(), /复用 0 份，重新生成 1 份/);
    assert.equal(await page.locator('#knowledgeRebuild').isChecked(), false);
    await page.uncheck('#knowledgeSemantic');
    assert.equal(await page.locator('#knowledgeRebuild').isDisabled(), true);
    assert.equal(await page.locator('#knowledgeCompact').isDisabled(), true);
    await page.click('#knowledgeClose');
  });
  if (process.env.BLINK_MODELS) await stage('cancelling vector export ignores late responses and preserves the one-time rebuild choice', async () => {
    await page.click('#knowledgeButton'); await page.check('#knowledgeSemantic');
    if (!await page.locator('.knowledge-vector-options').evaluate(node => node.open)) await page.locator('.knowledge-vector-options summary').click();
    await page.check('#knowledgeRebuild');
    const downloads = [];
    const listener = download => downloads.push(download); page.on('download', listener);
    await page.click('#knowledgeDownload');
    await page.waitForFunction(() => document.getElementById('knowledgeBatchCancel').textContent === '取消向量生成', null, { timeout: 60000 });
    await page.click('#knowledgeBatchCancel'); assert.match(await page.locator('#knowledgeStatus').innerText(), /手册来源仍可用于重新导出/); await page.click('#knowledgeClose');
    await page.click('#knowledgeButton'); await page.locator('#knowledgeDownload:not([disabled])').waitFor();
    assert.equal(downloads.length, 0); assert.equal(await page.locator('#knowledgeError').innerText(), '');
    assert.equal(await page.locator('#knowledgeRebuild').isChecked(), true);
    page.removeListener('download', listener); await page.uncheck('#knowledgeRebuild'); await page.uncheck('#knowledgeSemantic'); await page.click('#knowledgeClose');
  });
  await stage('switching repositories preserves the first snapshot, namespaces same-path Topics and excludes other models from the index', async () => {
    await page.selectOption('#repositorySelect', extra); await page.waitForFunction(extra => window.DitaApp.state.root === extra, extra);
    await page.evaluate(() => window.DitaApp.openFile('extra.ditamap')); await page.click('#knowledgeButton');
    await page.locator('#knowledgeSources input[value="extra.ditamap"]').check();
    await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled); assert.equal(await page.locator('#knowledgePrefixes').isChecked(), false); assert.equal(await page.locator('#knowledgeFilter').inputValue(), '');
    await page.click('#knowledgeAdd'); await page.waitForFunction(() => document.getElementById('knowledgeError').textContent.includes('Oxygen 修订起始标记没有对应终点'));
    await page.selectOption('#knowledgeFilter', 'exclude-internal.ditaval');
    await page.click('#knowledgeAdd'); await page.waitForFunction(() => document.getElementById('knowledgeError').textContent.includes('DITAVAL'));
    assert.equal(await page.locator('.knowledge-part').count(), 1, 'a missing body profile must not silently add another model');
    await page.locator('#knowledgeFilter option[value="ml307g.ditaval"]').waitFor({ state: 'attached' }); await page.selectOption('#knowledgeFilter', 'ml307g.ditaval'); await addCurrent();
    assert.equal(await page.locator('.knowledge-part').count(), 2);
    if (process.env.BLINK_MODELS) {
      await page.check('#knowledgeSemantic'); await download();
      assert.match(await page.locator('#knowledgeVectorStatus').innerText(), /复用 1 份，重新生成 1 份/);
      await page.uncheck('#knowledgeSemantic');
    }
    const result = await download(), files = unzipSync(new Uint8Array(result.bytes)), manifest = JSON.parse(strFromU8(files['docs/manifest.json']));
    assert.equal(manifest.manuals.length, 2); assert.equal(new Set(manifest.manuals.map(item => item.id)).size, 2);
    const content = strFromU8(files['docs/index.html']); assert.doesNotMatch(content, /ONLY_N_PRIVATE_NOTE|ONLY_N_PRIVATE_BODY|INTERNAL_UNPAIRED_REVISION/); assert.match(content, /ONLY_G_NOTE/);
    const first = manifest.manuals.find(item => item.source.manualPath === mapPath);
    assert.equal(first.chapters, 24); assert.doesNotMatch(content, /400-110-0866|服务与支持/);
    assert.equal(first.source.documents.find(item => item.path === 'topics/r_https_example.dita').sha256, hash(original.get('topics/r_https_example.dita')));
    for (const manual of manifest.manuals) assert.equal(manual.htmlSha256, hash(files['docs/' + manual.file]));
    const moved = path.join(temporary, '移动 空格', '离线文档'); await fs.mkdir(moved, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) { const target = path.join(moved, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); }
    const offline = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), requests = [], offlineErrors = [];
    offline.on('pageerror', error => offlineErrors.push(error.message)); offline.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await offline.context().setOffline(true); await offline.goto(pathToFileURL(path.join(moved, 'docs/index.html')).href);
    await offline.locator('#kbSearch').fill('AT+KBTEST_'); await offline.locator('#kbSuggestions button').first().waitFor(); await offline.locator('#kbSearch').press('ArrowDown'); await offline.locator('#kbSearch').press('Enter');
    await offline.locator('#kbMode').selectOption('AT'); assert.equal(await offline.locator('#kbResultList .search-result').count(), 0); await offline.locator('#kbMode').selectOption('');
    await offline.locator('#kbCatalogToggle').click(); await offline.locator('#kbSymbolQuery').fill('AT+KBTEST_'); assert.equal(await offline.locator('#kbSymbolList .symbol-item').count(), 1); await offline.locator('#kbCatalogToggle').click();
    await offline.locator('#kbSearch').fill('AT+KBTEST_G'); await offline.locator('#kbSearch').press('Enter');
    assert.equal(await offline.locator('#kbResultList .search-result').count(), 1); await offline.locator('#kbResultList .search-result').click();
    await offline.locator('#kbReading:not([hidden])').waitFor();
    assert.match(await offline.locator('#kbArticle').innerText(), /ONLY_G_NOTE/); assert.doesNotMatch(await offline.locator('#kbArticle').innerText(), /ONLY_N_PRIVATE/);
    await offline.locator('.code-copy').click(); await offline.waitForFunction(() => /已复制|选中代码/.test(document.querySelector('.code-copy').textContent));
    await offline.setViewportSize({ width: 390, height: 844 }); assert.equal(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(requests, []); assert.deepEqual(offlineErrors, []); await offline.context().setOffline(false); await offline.close();
    // Replace the synthetic second library before producing a user-facing sample.
    await page.locator('.knowledge-part').filter({ hasText: '独立功能验收' }).getByRole('button', { name: '移除' }).click(); await page.click('#knowledgeClose');
  });
  await stage('the preview sample contains only real HTTP sources and does not change the input library', async () => {
    await page.selectOption('#repositorySelect', http); await page.waitForFunction(http => window.DitaApp.state.root === http, http);
    await page.evaluate(() => window.DitaApp.openFile('topics/r_https_example.dita')); await page.click('#knowledgeButton');
    await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled); assert.equal(await page.locator('#knowledgePrefixes').isChecked(), true); assert.equal(await page.locator('#knowledgeFilter').inputValue(), 'filters/filter_tbd.ditaval');
    for (const input of await page.locator('#knowledgeSources input').all()) await input.uncheck();
    await page.locator('#knowledgeSources input[value="topics/r_https_example.dita"]').check();
    await page.locator('#knowledgeFilter option[value="filters/filter_tbd.ditaval"]').waitFor({ state: 'attached' });
    await page.selectOption('#knowledgeFilter', 'filters/filter_tbd.ditaval'); await addCurrent();
    const result = await download();
    if (process.env.DITA_KNOWLEDGE_QA_DIR) {
      await fs.mkdir(process.env.DITA_KNOWLEDGE_QA_DIR, { recursive: true }); await fs.writeFile(path.join(process.env.DITA_KNOWLEDGE_QA_DIR, result.filename), result.bytes);
      const files = unzipSync(new Uint8Array(result.bytes));
      for (const [name, bytes] of Object.entries(files)) { const target = path.join(process.env.DITA_KNOWLEDGE_QA_DIR, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); }
      await page.screenshot({ path: path.join(process.env.DITA_KNOWLEDGE_QA_DIR, 'knowledge-dialog.png') });
      await page.click('#knowledgePreview'); await page.frameLocator('#knowledgePreviewFrame').locator('#kbManualCards .manual-card').first().waitFor();
      await page.frameLocator('#knowledgePreviewFrame').locator('body').screenshot({ path: path.join(process.env.DITA_KNOWLEDGE_QA_DIR, 'reader-home.png') });
      await page.screenshot({ path: path.join(process.env.DITA_KNOWLEDGE_QA_DIR, 'workbench-preview.png') });
    }
    for (const [name, bytes] of original) assert.deepEqual(await fs.readFile(path.join(http, name)), bytes);
    assert.equal(await fs.readFile(path.join(extra, extraPath), 'utf8'), extraSource); assert.deepEqual(errors, []);
  });
  await stage('unsaved and cancelled captures leave the sealed publication collection unchanged', async () => {
    if (await page.locator('#knowledgePreviewDialog[open]').count()) await page.click('#knowledgePreviewClose');
    await page.click('#knowledgeClose');
    await page.evaluate(() => { const app = window.DitaApp, file = app.state.filesMap.get('topics/r_https_example.dita'); app.setFileContent(file, file.current + '<!-- draft -->'); });
    await page.click('#knowledgeButton');
    for (const input of await page.locator('#knowledgeSources input').all()) await input.uncheck();
    await page.locator('#knowledgeSources input[value="topics/r_https_example.dita"]').check(); await page.click('#knowledgeAdd');
    await page.waitForFunction(() => document.getElementById('knowledgeError').textContent.includes('请先保存'));
    assert.equal(await page.locator('.knowledge-part').count(), 2);
    await page.evaluate(() => { const app = window.DitaApp, file = app.state.filesMap.get('topics/r_https_example.dita'); app.setFileContent(file, file.disk); });
    let release, entered;
    const hold = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const url = '**/api/file?path=topics%2Fr_https_example.dita';
    await page.route(url, async route => { entered(); await hold; await route.continue().catch(() => {}); });
    await page.click('#knowledgeAdd'); await started; await page.click('#knowledgeClose'); release();
    await page.unroute(url); await page.click('#knowledgeButton'); assert.equal(await page.locator('.knowledge-part').count(), 2);
  });
  await stage('publication conditions are isolated by branch and restored on return', async () => {
    const initial = await page.evaluate(() => window.DitaApp.state.currentBranch);
    await page.click('#knowledgeClose'); await page.selectOption('#branchSelect', 'alternate'); await page.waitForFunction(() => window.DitaApp.state.currentBranch === 'alternate');
    await page.click('#knowledgeButton'); await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled);
    assert.equal(await page.locator('#knowledgePrefixes').isChecked(), false); assert.equal(await page.locator('#knowledgeFilter').inputValue(), ''); assert.equal(await page.locator('#knowledgeVersion').inputValue(), '');
    await page.fill('#knowledgeVersion', 'alternate-only'); await page.click('#knowledgeClose'); await page.selectOption('#branchSelect', initial); await page.waitForFunction(initial => window.DitaApp.state.currentBranch === initial, initial);
    await page.click('#knowledgeButton'); await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled);
    assert.equal(await page.locator('#knowledgePrefixes').isChecked(), true); assert.equal(await page.locator('#knowledgeFilter').inputValue(), 'filters/filter_tbd.ditaval'); assert.equal(await page.locator('#knowledgeVersion').inputValue(), 'HTTP真实手册');
  });
  await stage('a late filter failure cannot disable a reopened dialog', async () => {
    await page.click('#knowledgeClose');
    await page.evaluate(() => {
      const manual = window.DitaApp.manual, original = manual.listFilters; let first = true;
      window.restoreKnowledgeFilters = () => { window.DitaApp.manual = manual; };
      window.DitaApp.manual = { ...manual, listFilters: () => { if (!first) return original(); first = false; return new Promise((_, reject) => { window.rejectOldKnowledgeFilters = () => reject(Error('old request failure')); }); } };
    });
    await page.click('#knowledgeButton'); assert.equal(await page.locator('#knowledgeAdd').isDisabled(), true);
    await page.click('#knowledgeClose'); await page.click('#knowledgeButton'); await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled);
    await page.evaluate(() => { window.rejectOldKnowledgeFilters(); window.restoreKnowledgeFilters(); });
    assert.equal(await page.locator('#knowledgeAdd').isDisabled(), false); assert.equal(await page.locator('#knowledgeError').innerText(), '');
  });
  await stage('saved plans restore metadata and require fresh captures after reload', async () => {
    await page.locator('.knowledge-part').first().getByRole('button', { name: '检索属性' }).click();
    await page.selectOption('#knowledgeEntry', { index: 0 }); await page.fill('#knowledgeAliases', '连接问题专用别名'); await page.click('#knowledgeMetadataSave'); await page.click('#knowledgeMetadataClose');
    await page.click('#knowledgePlanSave'); await page.waitForFunction(() => document.getElementById('knowledgeStatus').textContent.includes('方案已保存'));
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('dita.knowledge.plan.v1:')).map(key => JSON.parse(localStorage.getItem(key))));
    assert.equal(stored.length, 1); assert.equal(stored[0].sources.length, 2); assert.match(JSON.stringify(stored[0]), /连接问题专用别名/); assert.doesNotMatch(JSON.stringify(stored[0]), /<!doctype|manualBody/);
    await page.locator('.knowledge-plan-bar summary').click(); const waiting = page.waitForEvent('download'); await page.click('#knowledgePlanExport'); const exported = await fs.readFile(await (await waiting).path(), 'utf8'); assert.deepEqual(JSON.parse(exported), stored[0]);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await page.click('#knowledgeButton');
    await page.locator('.knowledge-part').first().waitFor(); assert.equal(await page.locator('.knowledge-part').count(), 2); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    assert.match(await page.locator('#knowledgeCollection').innerText(), /待重新核对/); await page.waitForFunction(() => !document.getElementById('knowledgeAdd').disabled);
    await addCurrent(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
    await page.click('#knowledgePreview'); const frame = page.frameLocator('#knowledgePreviewFrame'); await frame.locator('#kbSearch').fill('连接问题专用别名'); await frame.locator('#kbSearch').press('Enter'); assert.ok(await frame.locator('#kbResultList .search-result').count() > 0); await page.click('#knowledgePreviewClose');
    await page.setInputFiles('#knowledgePlanImport', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await page.waitForFunction(() => document.getElementById('knowledgeStatus').textContent.includes('方案已导入')); assert.match(await page.locator('#knowledgeStatus').innerText(), /方案已导入/); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    assert.deepEqual(errors, []);
    const missing = JSON.parse(exported); missing.sources[0].filterPath = 'filters/missing.ditaval';
    await page.setInputFiles('#knowledgePlanImport', { name: 'missing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(missing)) });
    await page.waitForFunction(() => document.getElementById('knowledgeError').textContent.includes('原方案条件文件不存在'));
    assert.equal(await page.locator('#knowledgeAdd').isDisabled(), true); await page.selectOption('#knowledgeFilter', 'filters/filter_tbd.ditaval'); assert.equal(await page.locator('#knowledgeAdd').isDisabled(), false);
    const moved = JSON.parse(exported); for (const source of moved.sources) source.repositoryRoot = 'E:\\old-machine\\http';
    await page.setInputFiles('#knowledgePlanImport', { name: 'moved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(moved)) });
    await page.locator('.knowledge-part').first().getByRole('button', { name: '关联当前库' }).waitFor();
    await page.locator('.knowledge-part').first().getByRole('button', { name: '关联当前库' }).click();
    assert.match(await page.locator('#knowledgeStatus').innerText(), /来源已关联/);
    assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
  });

});
