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
  const tcpPath = 'topics/r_at_mhttpcfg.dita', tcpBody = '<topic id="tcp"><title>TCP功能验收</title><body><p>AT+TCP_G<fn product="ML307G">TCP_G_NOTE</fn><fn product="ML307N">PRIVATE_TCP_N</fn></p><p product="ML307N">PRIVATE_TCP_N_BODY</p><p><xref type="fn" href="../shared.dita#defs/n"/></p></body></topic>';
  await fs.writeFile(path.join(tcp, 'shared.dita'), '<topic id="defs"><title>定义</title><body><p><fn id="n" product="ML307G">TCP_SHARED_G<ph product="ML307N">PRIVATE_TCP_N_FOOTNOTE</ph></fn></p></body></topic>');
  const filter = '<val><prop att="product" val="ML307N" action="exclude"/></val>';
  await fs.writeFile(path.join(tcp, tcpPath), tcpBody); await fs.writeFile(path.join(tcp, 'tcp.ditamap'), '<map><title>TCP手册</title><topicref href="' + tcpPath + '"/></map>'); await fs.writeFile(path.join(tcp, 'g.ditaval'), filter);
  const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const common = path.join(http, 'contentmodule');
  git(common, 'init', '-b', 'main'); git(common, 'add', '.'); git(common, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'shared content');
  await fs.writeFile(path.join(http, '.gitmodules'), '[submodule "contentmodule"]\n\tpath = contentmodule\n\turl = ../shared.git\n');
  for (const root of [http, tcp]) { git(root, 'init', '-b', 'main'); git(root, 'add', '.'); git(root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'initial'); }
  git(http, 'submodule', 'absorbgitdirs', '--', 'contentmodule');
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
    if (await page.locator('#knowledgeSourceRepo').inputValue() !== root) { await page.selectOption('#knowledgeSourceRepo', root); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); }
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
  await stage('changing repositories refreshes entries and filters without a manual reload', async () => {
    const entries = page.locator('#knowledgeSourceEntry'), filters = page.locator('#knowledgeSourceFilter');
    await page.click('#knowledgeSourcesAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    assert.equal(await entries.inputValue(), map);
    await page.selectOption('#knowledgeSourceRepo', tcp);
    assert.ok(!(await entries.locator('option').evaluateAll(options => options.map(option => option.value))).includes(map),
      'switching to TCP must immediately remove the HTTP manual from the entry list');
    await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    assert.equal(await entries.inputValue(), 'tcp.ditamap');
    assert.deepEqual(await filters.locator('option').evaluateAll(options => options.map(option => option.value)), ['', 'g.ditaval']);
    await page.click('#knowledgeSourceClose');
  });
  await stage('manual refresh rereads the selected repository and can recover after an error', async () => {
    const entries = page.locator('#knowledgeSourceEntry'), add = page.locator('#knowledgeSourceAdd');
    const extra = path.join(tcp, 'new-manual.ditamap'), endpoint = '**/api/knowledge/catalog';
    await page.click('#knowledgeSourcesAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    await page.route(endpoint, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '目录暂不可用' }) }));
    await page.selectOption('#knowledgeSourceRepo', tcp);
    await page.locator('#knowledgeSourceInfo').filter({ hasText: '目录暂不可用' }).waitFor();
    assert.match(await page.locator('#knowledgeSourceInfo').innerText(), /TCP文档库/);
    assert.equal(await entries.locator('option').count(), 0); assert.equal(await add.isDisabled(), true);
    await page.unroute(endpoint);
    try {
      await fs.writeFile(extra, '<map><title>新增手册</title></map>');
      await page.click('#knowledgeSourceReload'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
      assert.deepEqual(await entries.locator('option').evaluateAll(options => options.map(option => option.value)), ['new-manual.ditamap', 'tcp.ditamap']);
      assert.match(await page.locator('#knowledgeSourceInfo').innerText(), /TCP文档库.*2 个入口/);
      await entries.selectOption('tcp.ditamap'); await fs.rm(extra);
      await page.click('#knowledgeSourceReload'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
      assert.equal(await entries.locator('option').count(), 1); assert.equal(await entries.inputValue(), 'tcp.ditamap');
    } finally { await fs.rm(extra, { force: true }); await page.click('#knowledgeSourceClose'); }
  });
  await stage('a late TCP catalog cannot replace HTTP after a second switch', async () => {
    await page.click('#knowledgeSourcesAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    const endpoint = '**/api/knowledge/catalog';
    let release, finish;
    const hold = new Promise(resolve => { release = resolve; }), finished = new Promise(resolve => { finish = resolve; });
    await page.route(endpoint, async route => {
      if (route.request().postDataJSON().repositoryRoot !== tcp) { await route.continue(); return; }
      try { const response = await route.fetch(); await hold; await route.fulfill({ response }).catch(() => {}); }
      finally { finish(); }
    });
    try {
      const requested = page.waitForRequest(req => req.url().endsWith('/api/knowledge/catalog') && req.postDataJSON().repositoryRoot === tcp);
      await page.selectOption('#knowledgeSourceRepo', tcp); await requested;
      assert.equal(await page.locator('#knowledgeSourceEntry').isDisabled(), true);
      assert.equal(await page.locator('#knowledgeSourceFilter option').count(), 0);
      await page.selectOption('#knowledgeSourceRepo', http); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
      release(); await finished;
      assert.equal(await page.locator('#knowledgeSourceEntry').inputValue(), map);
      assert.match(await page.locator('#knowledgeSourceInfo').innerText(), /HTTP文档库/);
      assert.equal(await page.locator('#knowledgeSourceRefs option[value="refs/tags/sdk-v1"]').count(), 0);
    } finally { release(); await page.unroute(endpoint); await page.click('#knowledgeSourceClose'); }
  });
  await stage('configure both libraries once, check them together, and preserve the active unsaved editor', async () => {
    await configure(http, map, 'filters/filter_tbd.ditaval', 'HTTP'); await configure(tcp, 'tcp.ditamap', 'g.ditaval', 'TCP');
    assert.equal(await page.locator('.knowledge-part').count(), 2); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    await check(); assert.match(await page.locator('#knowledgeStatus').innerText(), /2\/2/); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => ({ root: window.DitaApp.state.root, branch: window.DitaApp.state.currentBranch, token: window.DitaApp.api.token, content: window.DitaApp.state.filesMap.get('scratch.dita').current })), identity);
    assert.equal(git(tcp, 'branch', '--show-current'), 'main');
    const files = await archive(), manifest = JSON.parse(strFromU8(files['docs/manifest.json'])); assert.equal(manifest.manuals.length, 2);
    const html = strFromU8(files['docs/index.html']); assert.match(html, /TCP_G_NOTE/); assert.match(html, /TCP_SHARED_G/);
    const manual = manifest.manuals.find(item => item.source.repository === 'TCP文档库');
    const standalone = strFromU8(files['docs/' + manual.file]); assert.match(standalone, /TCP_SHARED_G/); assert.doesNotMatch(standalone, /PRIVATE_TCP_N/); assert.doesNotMatch(html, /PRIVATE_TCP_N|UNSAVED_BUFFER_KEPT/);
    const httpManual = manifest.manuals.find(item => item.source.repository === 'HTTP文档库');
    assert.equal(httpManual.report.included, 25); assert.equal(httpManual.chapters, 24);
    assert.doesNotMatch(html + strFromU8(files['docs/' + httpManual.file]), /400-110-0866|服务与支持/);
    assert.ok(httpManual.source.documents.some(file => file.path.endsWith('/c_at_command_syntax_format_cn.dita')));
    assert.ok(httpManual.source.assets.some(file => file.path.endsWith('/logo_color_cn.png')));
    await page.click('#knowledgePreview'); const frame = page.frameLocator('#knowledgePreviewFrame'); await frame.locator('#kbSearch').fill('AT+TCP_G'); await frame.locator('#kbSearch').press('Enter'); assert.equal(await frame.locator('.search-result').count(), 1); await page.click('#knowledgePreviewClose');
    if (process.env.DITA_KNOWLEDGE_QA_DIR) { await fs.mkdir(process.env.DITA_KNOWLEDGE_QA_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.DITA_KNOWLEDGE_QA_DIR, 'multi-repository-plan.png') }); }
  });
  await stage('standalone delivery keeps service and support, while the knowledge package tolerates its absence', async () => {
    const support = 'contentmodule/topics/reusable_general_cn/g_service_and_support_cn.dita';
    const standalone = await page.evaluate(async map => {
      const app = window.DitaApp, snapshot = await app.manual.capture(map, { filterPath: 'filters/filter_tbd.ditaval' });
      return app.ditaCore.exportMapToHtml({ map: snapshot.map, files: snapshot.files, title: 'HTTP', model: 'ML307G',
        publicationData: app.manual.prepare(snapshot, 'ML307G', true, { prefixes: true }) });
    }, map);
    assert.match(standalone, /400-110-0866/);
    await fs.unlink(path.join(http, support));
    try {
      await check();
      const contents = await archive(), manifest = JSON.parse(strFromU8(contents['docs/manifest.json']));
      const manual = manifest.manuals.find(item => item.source.repository === 'HTTP文档库');
      assert.equal(manual.chapters, 24); assert.ok(!manual.source.documents.some(record => record.path === support));
      assert.doesNotMatch(strFromU8(contents['docs/index.html']), /服务与支持|400-110-0866/);
    } finally { await fs.writeFile(path.join(http, support), original.get(support)); }
  });
  await stage('a failed source blocks delivery and retry only recaptures that source', async () => {
    await fs.rm(path.join(tcp, 'g.ditaval')); await check(); assert.match(await page.locator('#knowledgeStatus').innerText(), /1\/2/); assert.equal(await page.locator('.knowledge-part[data-source-state="error"]').count(), 1); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    await fs.writeFile(path.join(tcp, 'g.ditaval'), filter); const previous = requests.length; await check('#knowledgeBatchRetry'); assert.deepEqual(requests.slice(previous), [tcp]); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
  });
  await stage('an unfiltered foreign-model span inside a referenced footnote blocks packaging', async () => {
    const selected = path.join(tcp, tcpPath);
    const bodyWithoutForeignParagraph = tcpBody.replace('<p product="ML307N">PRIVATE_TCP_N_BODY</p>', '');
    await fs.writeFile(selected, bodyWithoutForeignParagraph); await fs.writeFile(path.join(tcp, 'g.ditaval'), '<val/>');
    await check(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), true);
    assert.match(await page.locator('.knowledge-part[data-source-state="error"]').innerText(), /shared\.dita.*其它型号/);
    await fs.writeFile(selected, tcpBody); await fs.writeFile(path.join(tcp, 'g.ditaval'), filter);
    await check('#knowledgeBatchRetry'); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
  });
  await stage('fixed tag content is captured without overwriting a dirty working directory', async () => {
    await fs.writeFile(path.join(tcp, tcpPath), tcpBody.replace('AT+TCP_G', 'AT+TCP_G WORKTREE_ONLY'));
    await page.locator('.knowledge-part').filter({ hasText: 'TCP手册' }).getByRole('button', { name: '编辑来源' }).click(); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    await page.selectOption('#knowledgeSourceMode', 'git'); await page.fill('#knowledgeSourceRevision', 'refs/tags/sdk-v1'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); await page.click('#knowledgeSourceAdd');
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
  await stage('quick-add cannot silently replace a pinned Git source with working files', async () => {
    const card = page.locator('.knowledge-part').filter({ hasText: 'http_httpsusermanual.ditamap' });
    await card.getByRole('button', { name: '编辑来源' }).click(); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    await page.selectOption('#knowledgeSourceMode', 'git'); await page.fill('#knowledgeSourceRevision', 'main'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); await page.click('#knowledgeSourceAdd');
    for (const checkbox of await page.locator('#knowledgeSources input').all()) await checkbox.uncheck();
    await page.locator('#knowledgeSources input[value="http_httpsusermanual.ditamap"]').check(); await page.click('#knowledgeAdd');
    assert.match(await page.locator('#knowledgeError').innerText(), /已指定 Git 版本/); assert.match(await card.innerText(), /Git 版本：main/);
    await page.click('#knowledgeSourcesAdd'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    await page.selectOption('#knowledgeSourceEntry', map); await page.click('#knowledgeSourceAdd');
    assert.equal(await page.locator('#knowledgeSourceDialog').isVisible(), true);
    assert.match(await page.locator('#knowledgeSourceInfo').innerText(), /编辑来源/);
    assert.match(await card.innerText(), /Git 版本：main/); await page.click('#knowledgeSourceClose');
    await card.getByRole('button', { name: '编辑来源' }).click(); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); await page.selectOption('#knowledgeSourceMode', 'saved'); await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled); await page.click('#knowledgeSourceAdd'); await check('#knowledgeBatchRetry');
    assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
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

  await stage('remapping an imported plan retains its topic and filter and requires explicit replacements for missing paths', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dita.knowledge.plan.v1:' + localStorage.getItem('dita.knowledge.lastPlan'))));
    const tcpSource = saved.sources.find(source => source.repositoryRoot === tcp);
    async function remap(entry, filterPath) {
      const plan = { ...saved, sources: [{ ...tcpSource, revision: '', branch: 'main', repositoryRoot: 'E:/old-machine/TCP', path: entry, filterPath }] };
      await page.setInputFiles('#knowledgePlanImport', { name: 'moved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
      await page.locator('.knowledge-part').filter({ hasText: entry }).getByRole('button', { name: '编辑来源' }).click();
      await page.selectOption('#knowledgeSourceRepo', tcp);
      await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
      assert.equal(await page.locator('#knowledgeSourceEntry').inputValue(), entry);
      assert.equal(await page.locator('#knowledgeSourceFilter').inputValue(), filterPath);
    }
    await remap(tcpPath, 'g.ditaval'); await page.click('#knowledgeSourceAdd');
    await check(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
    await remap('old.ditamap', 'old.ditaval');
    await page.click('#knowledgeSourceAdd'); assert.match(await page.locator('#knowledgeSourceInfo').innerText(), /原手册入口不存在/);
    await page.selectOption('#knowledgeSourceEntry', 'tcp.ditamap'); await page.click('#knowledgeSourceAdd');
    assert.match(await page.locator('#knowledgeSourceInfo').innerText(), /原条件文件不存在/);
    await page.selectOption('#knowledgeSourceFilter', 'g.ditaval'); await page.click('#knowledgeSourceReload');
    await page.waitForFunction(() => !document.getElementById('knowledgeSourceAdd').disabled);
    assert.equal(await page.locator('#knowledgeSourceEntry').inputValue(), 'tcp.ditamap');
    assert.equal(await page.locator('#knowledgeSourceFilter').inputValue(), 'g.ditaval');
    await page.click('#knowledgeSourceAdd'); await check(); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
  });

  await stage('quick add preserves per-manual settings and branch bindings after importing a plan', async () => {
    const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('dita.knowledge.plan.v1:' + localStorage.getItem('dita.knowledge.lastPlan'))));
    const first = plan.sources.find(source => source.repositoryRoot === http), second = {
      ...first, path: 'topics/r_https_example.dita', filterPath: 'filters/telecomversion.ditaval',
      module: 'HTTPS 示例', version: 'V2', overrides: {}
    };
    const importPlan = value => page.setInputFiles('#knowledgePlanImport', { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await importPlan({ ...plan, sources: [first, second] });
    await page.waitForFunction(() => document.querySelectorAll('.knowledge-part').length === 2 && !document.getElementById('knowledgeAdd').disabled);
    const checkbox = page.locator('#knowledgeSources input');
    const selected = () => checkbox.evaluateAll(inputs => inputs.filter(input => input.checked).map(input => input.value));
    assert.deepEqual(await selected(), [first.path]);
    await page.locator('#knowledgeSources input[value="topics/r_https_example.dita"]').check();
    await page.click('#knowledgeAdd');
    assert.match(await page.locator('#knowledgeError').innerText(), /不同.*核对全部来源/);
    await page.locator('#knowledgeSources input[value="http_httpsusermanual.ditamap"]').uncheck();
    assert.equal(await page.locator('#knowledgeFilter').inputValue(), second.filterPath);
    assert.equal(await page.locator('#knowledgeVersion').inputValue(), second.version);
    assert.equal(await page.locator('#knowledgeModule').inputValue(), second.module);
    await check();
    const files = await archive(), manifest = JSON.parse(strFromU8(files['docs/manifest.json']));
    for (const recipe of [first, second]) {
      const item = manifest.manuals.find(result => result.source.manualPath === recipe.path);
      assert.equal(item.source.filterPath, recipe.filterPath); assert.equal(item.version, recipe.version); assert.equal(item.module, recipe.module);
    }
    await importPlan({ ...plan, model: '', sources: [first] });
    await page.locator('#knowledgeError').filter({ hasText: '型号' }).waitFor();
    assert.equal(await page.locator('.knowledge-part').count(), 2); assert.equal(await page.locator('#knowledgeDownload').isDisabled(), false);
    await importPlan({ ...plan, sources: [{ ...first, branch: 'another-branch' }] });
    await page.waitForFunction(() => document.querySelectorAll('.knowledge-part').length === 1 && !document.getElementById('knowledgeAdd').disabled);
    await page.locator('#knowledgeSources input[value="http_httpsusermanual.ditamap"]').check(); await page.click('#knowledgeAdd');
    assert.match(await page.locator('#knowledgeError').innerText(), /分支.*编辑来源/);
    assert.match(await page.locator('#knowledgeCollection').innerText(), /another-branch/);
  });

});
