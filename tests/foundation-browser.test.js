'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright-core');
test('foundation browser workflows', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-foundation-')), repo = path.join(temporary, 'docs');
  await fs.cp(path.join(__dirname, 'fixtures/manual'), repo, { recursive: true });
  const other = '<topic id="other"><title>Other</title><body><p>OTHER</p></body></topic>';
  await fs.writeFile(path.join(repo, 'other.dita'), other);
  const originalConnect = await fs.readFile(path.join(repo, 'topics/connect.dita'), 'utf8');
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temporary, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message)); const promptAnswers = []; page.on('dialog', dialog => dialog.accept(promptAnswers.length ? promptAnswers.shift() : undefined));
  const base = 'http://127.0.0.1:' + port;
  const ready = async () => { await page.waitForFunction(() => window.DitaApp?.state.root && window.DitaApp.project.expectedContent !== undefined); };
  await page.goto(base); await ready();
  const open = async file => { await page.click('[data-view="search"]'); await page.fill('#workspaceSearchInput', file); await page.locator('.workspace-result').filter({ hasText: file }).click(); await page.waitForFunction(file => window.DitaApp.state.activePath === file, file); };
  const source = async content => { if (!await page.locator('#sourceButton').isVisible()) await page.click('.editing-tools summary'); await page.click('#sourceButton'); if (await page.locator('.editing-tools[open]').count()) await page.click('.editing-tools summary'); if (content !== undefined) await page.fill('#editor', content); };
  const current = () => page.evaluate(() => { const A = window.DitaApp; return A.state.filesMap.get(A.state.activePath).current; });
  const delivery = async () => { await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor(); };
  let failed = false;
  async function scenario(name, action) {
    await t.test(name, { skip: failed }, async () => {
      try { await action(); }
      catch (error) { failed = true; console.error('Workflow failure:', name, error.message); console.error(await page.locator('body').innerText()); throw error; }
      finally { await page.locator('dialog[open]').evaluateAll(dialogs => dialogs.forEach(dialog => dialog.close())); if (await page.locator('#htmlPreviewPane.active').count()) await page.click('#closeHtmlPreviewButton'); }
    });
  }
  await scenario('published note scope, inherited conditions and dependency save confirmation agree', async () => {
    await open('main.ditamap'); await page.click('#footnotesButton'); await page.selectOption('#footnoteModel', 'M100');
    await page.waitForFunction(() => document.querySelectorAll('.footnote-card').length === 4);
    assert.doesNotMatch(await page.locator('#footnoteList').innerText(), /INHERITED_B|ANCESTOR_EXCLUDED|C_ONLY/);
    await page.locator('.footnote-card').filter({ hasText: 'A_CONREF' }).getByRole('button', { name: '编辑引用源' }).click(); await page.locator('#footnoteEditDialog').waitFor();
    assert.match(await page.locator('#footnoteSourceHint').innerText(), /公共引用源/);
    await page.fill('#footnoteContent', 'A_EDITED'); await page.click('#footnoteEditForm button[type=submit]');
    assert.match(await current(), /A_EDITED/); assert.doesNotMatch(await fs.readFile(path.join(repo, 'shared/notes.dita'), 'utf8'), /A_EDITED/);
    await open('other.dita'); await source(other.replace('OTHER', 'OTHER_DIRTY'));
    await open('main.ditamap'); await page.click('#saveButton'); await page.locator('#saveScopeDialog').waitFor();
    assert.match(await page.locator('#saveScopeList').innerText(), /shared\/notes.dita/); assert.doesNotMatch(await page.locator('#saveScopeList').innerText(), /other.dita/);
    await page.click('#saveScopeConfirm'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('shared/notes.dita').dirty);
    assert.match(await fs.readFile(path.join(repo, 'shared/notes.dita'), 'utf8'), /A_EDITED/);
    assert.equal(await fs.readFile(path.join(repo, 'other.dita'), 'utf8'), other);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('other.dita').dirty), true);
    await open('other.dita'); await source(other);
  });
  await scenario('project registry validates edits and confirmed common applicability is explicit', async () => {
    await page.click('#projectButton'); await page.fill('#projectModels', 'M100\nM200\nM300'); await page.click('#projectForm button[type=submit]');
    await page.waitForFunction(() => !document.getElementById('projectDialog').open);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(repo, '.dita-project.json'), 'utf8')).models, ['M100', 'M200', 'M300']);
    await open('topics/connect.dita'); await page.click('#footnotesButton'); await page.selectOption('#footnoteModel', '');
    await page.locator('.footnote-card').filter({ hasText: 'UNMARKED' }).getByRole('button', { name: '编辑注脚' }).click();
    await page.check('#footnoteCommon'); await page.click('#footnoteEditForm button[type=submit]');
    assert.match(await current(), /otherprops="applicability\(common\)"/);
    await page.waitForFunction(() => document.getElementById('footnoteUnassigned').textContent === '0');
    await page.locator('.footnote-card').filter({ hasText: 'A_EDITED' }).getByRole('button', { name: '编辑引用源' }).click(); await page.locator('#footnoteEditDialog').waitFor();
    const before = await current(); assert.equal(await page.locator('#footnoteProducts').isVisible(), false);
    assert.deepEqual(await page.locator('#footnoteModels input').evaluateAll(inputs => inputs.map(input => input.value)), ['M100', 'M200', 'M300']);
    assert.equal(await current(), before); await page.click('#footnoteCancel');
  });
  let working;
  await scenario('repository full-text search includes unsaved buffers and locates across inline XML', async () => {
    await open('topics/connect.dita'); working = (await current()).replace('</body>', '<p>临时搜索词 TCP <b>connection</b> &amp; MQTT</p></body>'); await source(working);
    await page.click('[data-view="search"]'); await page.selectOption('#contentSearchScope', 'repository'); await page.fill('#contentSearchInput', 'TCP connection'); await page.click('#contentSearchButton');
    const result = page.locator('.content-search-result').filter({ hasText: 'topics/connect.dita' }); await result.waitFor(); await result.click();
    assert.equal(await page.evaluate(() => { const el = document.getElementById('editor'); return el.value.slice(el.selectionStart, el.selectionEnd); }), 'TCP <b>connection');
    assert.doesNotMatch(await fs.readFile(path.join(repo, 'topics/connect.dita'), 'utf8'), /临时搜索词/);
  });
  await scenario('refresh recovery is undoable and refuses an externally changed disk base', async () => {
    await page.evaluate(() => window.DitaApp.drafts.flush()); await page.reload(); await ready(); await open('topics/connect.dita');
    assert.doesNotMatch(await current(), /临时搜索词/);
    await page.click('#draftsButton'); await page.locator('#draftList article').filter({ hasText: 'topics/connect.dita' }).getByRole('button', { name: '恢复到编辑区' }).click();
    await page.waitForFunction(() => window.DitaApp.state.filesMap.get('topics/connect.dita').current.includes('临时搜索词'));
    assert.equal(await current(), working);
    await source(); await page.focus('#editor'); await page.keyboard.press('Control+z'); assert.equal(await current(), originalConnect);
    await page.keyboard.press('Control+y'); assert.equal(await current(), working); await page.evaluate(() => window.DitaApp.drafts.flush());
    const external = originalConnect.replace('正文始终保留', 'EXTERNAL_BODY'); await fs.writeFile(path.join(repo, 'topics/connect.dita'), external);
    // Recovery must re-read disk even while the original file remains cached in this tab.
    await page.click('#draftsButton'); await page.locator('#draftList article').filter({ hasText: 'topics/connect.dita' }).getByRole('button', { name: '恢复到编辑区' }).click();
    await page.waitForFunction(() => document.getElementById('draftError').textContent.includes('磁盘或编辑内容已变化'));
    assert.match(await page.locator('#draftError').innerText(), /磁盘或编辑内容已变化/); assert.equal(await current(), working); await page.click('#draftClose');
    await page.reload(); await ready(); await open('topics/connect.dita'); await page.click('#draftsButton');
    const row = page.locator('#draftList article').filter({ hasText: 'topics/connect.dita' }); await row.getByRole('button', { name: '恢复到编辑区' }).click();
    await page.waitForFunction(() => document.getElementById('draftError').textContent.includes('磁盘或编辑内容已变化'));
    assert.match(await page.locator('#draftError').innerText(), /磁盘或编辑内容已变化/); assert.equal(await current(), external);
    const downloadPromise = page.waitForEvent('download'); await row.getByRole('button', { name: '下载草稿' }).click();
    const download = await downloadPromise; assert.match(await fs.readFile(await download.path(), 'utf8'), /临时搜索词/);
    assert.equal(await fs.readFile(path.join(repo, 'topics/connect.dita'), 'utf8'), external);
  });
  async function picker(kind) {
    if (!await page.locator('#insertElementSelect').isVisible()) await page.click('.editing-tools summary'); await page.selectOption('#insertElementSelect', kind === 'image' ? 'image' : 'xref'); await page.click('#insertElementButton');
    await page.waitForFunction(() => document.getElementById('resourceTarget').options.length > 0);
  }
  await scenario('image and Topic-link pickers insert correct relative paths and upload without overwriting', async () => {
    await open('topics/publish.dita'); await source(); const before = await current();
    await picker('image'); await page.fill('#resourceLabel', '网络图'); await page.click('#resourceForm button[type=submit]');
    assert.match(await current(), /href="\.\.\/assets\/network.svg" alt="网络图"/);
    await source(); await page.focus('#editor'); await page.keyboard.press('Control+z'); assert.equal(await current(), before);
    await picker('image');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.setInputFiles('#resourceUpload', { name: 'upload.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.getElementById('resourceMessage').textContent.includes('图片已添加'));
    await page.fill('#resourceLabel', '上传示例'); await page.click('#resourceForm button[type=submit]');
    assert.deepEqual(await fs.readFile(path.join(repo, 'assets/upload.png')), png);
    assert.match(await current(), /href="\.\.\/assets\/upload.png"/);
    await picker('link'); const options = await page.locator('#resourceTarget option').allTextContents();
    await page.selectOption('#resourceTarget', String(options.findIndex(text => text.includes('topics/connect.dita'))));
    await page.fill('#resourceLabel', '连接命令'); await page.click('#resourceForm button[type=submit]'); assert.match(await current(), /href="connect.dita#connect">连接命令/);
  });
  await scenario('document creation, GBK save-as and UTF-8 XML downloads retain text and declared encodings', async () => {
    promptAnswers.push('topic', 'new-topic.dita', '新建基础文档'); await page.click('#newDocumentButton');
    await page.waitForFunction(() => window.DitaApp.state.activePath === 'new-topic.dita');
    const content = '<?xml version="1.0" encoding="GBK"?><topic id="new"><title>中文文档</title><body><p>编码下载</p></body></topic>';
    await source(content); await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('new-topic.dita').dirty);
    assert.equal(require('iconv-lite').decode(await fs.readFile(path.join(repo, 'new-topic.dita')), 'gbk'), content);
    await page.click('button[data-menu=file]'); const downloadPromise = page.waitForEvent('download'); await page.locator('#menuPopup').getByRole('button', { name: '下载', exact: true }).click();
    const xml = await fs.readFile(await (await downloadPromise).path(), 'utf8'); assert.match(xml, /encoding="UTF-8"/); assert.match(xml, /编码下载/); assert.equal(await current(), content);
    promptAnswers.push('copy-topic.dita'); await page.click('button[data-menu=file]'); await page.locator('#menuPopup').getByRole('button', { name: '另存为', exact: true }).click();
    await page.waitForFunction(() => window.DitaApp.state.activePath === 'copy-topic.dita');
    assert.equal(require('iconv-lite').decode(await fs.readFile(path.join(repo, 'copy-topic.dita')), 'gbk'), content);
  });
  await scenario('cancelling an in-flight delivery never starts a download', async () => {
    await open('main.ditamap'); await delivery(); await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', 'html');
    let release, intercepted, downloaded = false;
    const held = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { intercepted = resolve; });
    const listener = () => { downloaded = true; }; page.on('download', listener);
    await page.route('**/api/asset?**', async route => { intercepted(); await held; await route.continue().catch(() => {}); });
    try {
      await page.click('#modelExportForm button[value=download]'); await seen;
      assert.equal(await page.locator('#exportModel').isDisabled(), true); await page.click('#modelExportCancel'); release();
      await page.waitForFunction(() => !document.getElementById('loadingOverlay').classList.contains('active'));
      assert.equal(downloaded, false); assert.equal(await page.locator('#htmlPreviewPane.active').count(), 0);
    } finally { release(); await page.unroute('**/api/asset?**'); page.off('download', listener); }
  });
  await scenario('unified delivery checks, preview and download records bind the actual output to its source snapshot', async () => {
    await open('main.ditamap'); await delivery(); await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', 'html'); await page.fill('#exportVersion', 'V2.1');
    await page.click('#modelExportForm button[value=check]'); await page.waitForFunction(() => document.getElementById('deliveryCheckStatus').textContent.includes('检查通过'));
    await page.click('#modelExportForm button[value=preview]'); const frame = page.frameLocator('#htmlPreviewFrame'); await frame.locator('.export-footnotes').waitFor();
    assert.match(await frame.locator('body').innerText(), /文档版本：V2.1/); assert.equal(await frame.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true); await page.click('#closeHtmlPreviewButton');
    await delivery(); await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', 'md');
    const downloadPromise = page.waitForEvent('download'); await page.click('#modelExportForm button[value=download]'); const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'main-M100-V2-1.md'); const output = await fs.readFile(await download.path(), 'utf8');
    await page.waitForFunction(() => window.DitaApp.lastDeliveryRecord?.state === 'download-initiated');
    const record = await page.evaluate(() => window.DitaApp.lastDeliveryRecord);
    assert.equal(record.version, 'V2.1'); assert.equal(record.source.commit, commit); assert.equal(record.source.dirty, true);
    assert.ok(record.unsavedPaths.includes('topics/publish.dita')); assert.equal(record.outputSha256, createHash('sha256').update(output).digest('hex'));
    assert.ok(record.documents.some(file => file.path === 'shared/notes.dita' && /^[a-f0-9]{64}$/.test(file.sha256)));
    await page.click('#releasesButton'); const row = page.locator('#releaseList article').first(); assert.match(await row.innerText(), /main-M100-V2-1.md/);
    const recordDownload = page.waitForEvent('download'); await row.getByRole('button', { name: '下载记录 JSON' }).click();
    assert.equal(JSON.parse(await fs.readFile(await (await recordDownload).path(), 'utf8')).outputSha256, record.outputSha256);
  });
  await scenario('publication problems are visible and navigate back to their source', async () => {
    await open('topics/connect.dita'); const previous = await current(); await source(previous.replace('</body>', '<p><xref href="missing.dita#t">Missing</xref></p></body>'));
    await open('main.ditamap'); await delivery(); await page.click('#modelExportForm button[value=check]');
    await page.waitForFunction(() => document.getElementById('modelExportError').textContent.includes('链接目标'));
    await page.locator('#deliveryChecks button').filter({ hasText: 'topics/connect.dita' }).click(); await page.waitForFunction(() => window.DitaApp.state.activePath === 'topics/connect.dita');
    assert.equal(await page.locator('#modelExportDialog').isVisible(), false); assert.match(await current(), /missing.dita/); await source(previous);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });
  assert.deepEqual(errors, []);
});
