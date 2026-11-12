'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core');
const { unzipSync, strFromU8 } = require('fflate'), { collectDemoFiles } = require('../scripts/demo-workspace');
test('one publication plan captures real HTTP and a separate Git manual without switching the editor', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-batch-browser-')), http = path.join(temporary, 'HTTP文档库'), tcp = path.join(temporary, 'TCP文档库');
  const map = 'http_httpsusermanual.ditamap', original = collectDemoFiles(path.join(__dirname, '../examples/http_httpsusermanual'), map);
  for (const [name, bytes] of original) { await fs.mkdir(path.dirname(path.join(http, name)), { recursive: true }); await fs.writeFile(path.join(http, name), bytes); }
  await fs.writeFile(path.join(http, 'scratch.dita'), '<topic id="scratch"><title>独立草稿</title><body><p>BUFFER_ORIGINAL</p></body></topic>');
  await fs.mkdir(path.join(tcp, 'topics'), { recursive: true });
  const tcpPath = 'topics/r_at_mhttpcfg.dita', tcpBody = '<topic id="tcp"><title>TCP功能验收</title><body><p>AT+TCP_G<fn product="ML307G">TCP_G_NOTE</fn><fn product="ML307N">PRIVATE_TCP_N</fn></p><p product="ML307N">PRIVATE_TCP_N_BODY</p></body></topic>';
  const filter = '<val><prop att="product" val="ML307N" action="exclude"/></val>';
  await fs.writeFile(path.join(tcp, tcpPath), tcpBody); await fs.writeFile(path.join(tcp, 'tcp.ditamap'), '<map><title>TCP手册</title><topicref href="' + tcpPath + '"/></map>'); await fs.writeFile(path.join(tcp, 'g.ditaval'), filter);
  const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const root of [http, tcp]) { git(root, 'init', '-b', 'main'); git(root, 'add', '.'); git(root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'initial'); }
  git(tcp, 'switch', '-c', 'release'); await fs.writeFile(path.join(tcp, tcpPath), tcpBody.replace('AT+TCP_G', 'AT+TCP_G RELEASE_ONLY')); git(tcp, 'add', '.'); git(tcp, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'release'); git(tcp, 'tag', 'sdk-v1'); const release = git(tcp, 'rev-parse', 'HEAD'); git(tcp, 'switch', 'main');
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const n = server.address().port; server.close(() => resolve(n)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: http, REPOSITORIES_ROOT: temporary, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.url().endsWith('/api/knowledge/capture')) requests.push(request.postDataJSON().repositoryRoot); });
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  await page.evaluate(async () => { const app = window.DitaApp; await app.openFile('scratch.dita'); const file = app.state.filesMap.get('scratch.dita'); app.setFileContent(file, file.current.replace('BUFFER_ORIGINAL', 'UNSAVED_BUFFER_KEPT')); });
  const identity = await page.evaluate(() => ({ root: window.DitaApp.state.root, branch: window.DitaApp.state.currentBranch, token: window.DitaApp.api.token, content: window.DitaApp.state.filesMap.get('scratch.dita').current }));
  await page.click('#knowledgeButton'); await page.fill('#knowledgeTitle', '多仓库统一交付'); await page.fill('#knowledgeModel', 'ML307G'); await page.fill('#knowledgeSdk', 'V1');
  async function configure(root, entry, profile, module) {
    await page.click('#knowledgeSourcesAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    if (await page.locator('#knowledgeSourceRepo').inputValue() !== root) { await page.selectOption('#knowledgeSourceRepo', root); await page.click('#knowledgeSourceReload'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); }
    await page.selectOption('#knowledgeSourceEntry', entry); await page.selectOption('#knowledgeSourceFilter', profile); await page.check('#knowledgeSourcePrefixes'); await page.fill('#knowledgeSourceModule', module); await page.selectOption('#knowledgeSourceKind', 'AT'); await page.click('#knowledgeSourceAdd');
    await page.locator('#knowledgeSourceDialog').waitFor({ state: 'hidden' });
  }
  async function check(button = '#knowledgeBatchCheck') { await page.click(button); await page.waitForFunction(() => !document.getElementById('knowledgeBatchCheck').disabled && document.getElementById('knowledgeStatus').textContent.startsWith('核对完成'), null, { timeout: 90000 }); }
  async function archive() { assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false, await page.locator('#knowledgeCollection').innerText()); const waiting = page.waitForEvent('download'); await page.click('#knowledgeDownload'); const download = await waiting; return unzipSync(new Uint8Array(await fs.readFile(await download.path()))); }
  async function stage(name, action) { let passed = false; await t.test(name, async () => { await action(); passed = true; }); assert.ok(passed, 'Stop after failed batch workflow: ' + name); }
  await stage('cross-repository routes keep the origin, workspace-token and repository allowlist guards', async () => {
    const endpoint = 'http://127.0.0.1:' + port + '/api/knowledge/catalog';
    assert.equal((await page.request.post(endpoint, { data: { repositoryRoot: tcp } })).status(), 409);
    assert.equal((await page.request.post(endpoint, { data: { repositoryRoot: tcp }, headers: { 'x-workspace-token': identity.token, origin: 'https://foreign.invalid' } })).status(), 403);
    assert.equal((await page.request.post(endpoint, { data: { repositoryRoot: os.tmpdir() }, headers: { 'x-workspace-token': identity.token } })).status(), 403);
  });
  await stage('configure both libraries once, check them together, and preserve the active unsaved editor', async () => {
    await configure(http, map, 'filters/filter_tbd.ditaval', 'HTTP'); await configure(tcp, 'tcp.ditamap', 'g.ditaval', 'TCP');
    assert.equal(await page.locator('.knowledge-part').count(), 2); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    await check(); assert.match(await page.locator('#knowledgeStatus').innerText(), /2\/2/); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => ({ root: window.DitaApp.state.root, branch: window.DitaApp.state.currentBranch, token: window.DitaApp.api.token, content: window.DitaApp.state.filesMap.get('scratch.dita').current })), identity);
    assert.equal(git(tcp, 'branch', '--show-current'), 'main');
    const files = await archive(), manifest = JSON.parse(strFromU8(files['docs/manifest.json'])); assert.equal(manifest.manuals.length, 2);
    const html = strFromU8(files['docs/index.html']); assert.match(html, /TCP_G_NOTE/); assert.doesNotMatch(html, /PRIVATE_TCP_N|UNSAVED_BUFFER_KEPT/);
    assert.equal(manifest.manuals.find(item => item.source.repository === 'HTTP文档库').report.included, 25);
    await page.click('#knowledgePreview'); const frame = page.frameLocator('#knowledgePreviewFrame'); await frame.locator('#kbSearch').fill('AT+TCP_G'); await frame.locator('#kbSearch').press('Enter'); assert.equal(await frame.locator('.search-result').count(), 1); await page.click('#knowledgePreviewClose');
    if (process.env.DITA_KNOWLEDGE_QA_DIR) { await fs.mkdir(process.env.DITA_KNOWLEDGE_QA_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.DITA_KNOWLEDGE_QA_DIR, 'multi-repository-plan.png') }); }
  });
  await stage('a failed source blocks delivery and retry only recaptures that source', async () => {
    await fs.rm(path.join(tcp, 'g.ditaval')); await check(); assert.match(await page.locator('#knowledgeStatus').innerText(), /1\/2/); assert.equal(await page.locator('.knowledge-part[data-source-state="error"]').count(), 1); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    await fs.writeFile(path.join(tcp, 'g.ditaval'), filter); const previous = requests.length; await check('#knowledgeBatchRetry'); assert.deepEqual(requests.slice(previous), [tcp]); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
  });
  await stage('fixed tag content is captured without overwriting a dirty working directory', async () => {
    await fs.writeFile(path.join(tcp, tcpPath), tcpBody.replace('AT+TCP_G', 'AT+TCP_G WORKTREE_ONLY'));
    await page.locator('.knowledge-part').filter({ hasText: 'TCP手册' }).getByRole('button', { name: '编辑来源' }).click(); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    await page.selectOption('#knowledgeSourceMode', 'git'); await page.fill('#knowledgeSourceRevision', 'refs/tags/sdk-v1'); await page.click('#knowledgeSourceReload'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); await page.click('#knowledgeSourceAdd');
    await check('#knowledgeBatchRetry'); const files = await archive(), html = strFromU8(files['docs/index.html']), manifest = JSON.parse(strFromU8(files['docs/manifest.json']));
    assert.match(html, /RELEASE_ONLY/); assert.doesNotMatch(html, /WORKTREE_ONLY/); assert.equal(manifest.manuals.find(item => item.title === 'TCP手册').source.commit, release);
    assert.equal(git(tcp, 'branch', '--show-current'), 'main'); assert.match(await fs.readFile(path.join(tcp, tcpPath), 'utf8'), /WORKTREE_ONLY/);
  });
  await stage('unsaved changes in a selected manual block its capture without modifying the buffer', async () => {
    await page.click('#knowledgeClose'); await page.evaluate(async () => { const app = window.DitaApp; await app.openFile('topics/r_at_mhttpcfg.dita'); const file = app.state.filesMap.get('topics/r_at_mhttpcfg.dita'); app.setFileContent(file, file.current + '<!-- UNSAVED_SELECTED -->'); }); await page.click('#knowledgeButton');
    await check(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true); assert.match(await page.locator('.knowledge-part[data-source-state="error"]').innerText(), /未保存|变化/);
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('topics/r_at_mhttpcfg.dita').current), /UNSAVED_SELECTED/);
    await page.evaluate(() => { const app = window.DitaApp, file = app.state.filesMap.get('topics/r_at_mhttpcfg.dita'); app.setFileContent(file, file.disk); }); await check('#knowledgeBatchRetry'); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
  });
  await stage('cancelling a batch discards incomplete results and late responses do not enable download', async () => {
    let entered, release; const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const url = '**/api/knowledge/capture'; await page.route(url, async route => { if (route.request().postDataJSON().repositoryRoot === tcp) { entered(); await hold; } await route.continue().catch(() => {}); });
    await page.click('#knowledgeBatchCheck'); await started; await page.click('#knowledgeBatchCancel'); release(); await page.unroute(url);
    assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true); assert.match(await page.locator('#knowledgeStatus').innerText(), /已取消/);
    await check(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
  });
  await stage('saved plans restore both sources and recapture all without workspace navigation', async () => {
    await page.click('#knowledgePlanSave'); await page.waitForFunction(() => document.getElementById('knowledgeStatus').textContent.includes('方案已保存'));
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await page.click('#knowledgeButton'); await page.locator('.knowledge-part').first().waitFor();
    assert.equal(await page.locator('.knowledge-part').count(), 2); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true); await check(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
    assert.equal(await page.evaluate(() => window.DitaApp.state.root), http); assert.deepEqual(errors, []);
    for (const [name, bytes] of original) assert.deepEqual(await fs.readFile(path.join(http, name)), bytes);
  });
  await stage('source configuration and batch controls remain reachable on a narrow viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#knowledgeDialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    await page.click('#knowledgeSourcesAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    assert.equal(await page.locator('#knowledgeSourceDialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    const footer = await page.locator('#knowledgeSourceAdd').boundingBox(); assert.ok(footer.y + footer.height <= 844);
    if (process.env.DITA_KNOWLEDGE_QA_DIR) await page.screenshot({ path: path.join(process.env.DITA_KNOWLEDGE_QA_DIR, 'multi-source-mobile.png') });
    await page.click('#knowledgeSourceClose'); await page.locator('#knowledgeBatchCheck').scrollIntoViewIfNeeded(); assert.equal(await page.locator('#knowledgeBatchCheck').isVisible(), true);
    assert.deepEqual(errors, []);
  });

});
