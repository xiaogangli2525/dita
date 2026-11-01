'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { chromium } = require('playwright-core'), { fixture, git, url } = require('./remote-fixture');
test('remote library browser workflow from an empty workspace', async t => {
  const f = await fixture(t), port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
  const server = spawn(process.execPath, ['tests/remote-browser-server.cjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DOCS_ROOT: f.root, REPOSITORIES_ROOT: f.managed, DITA_REMOTE_FIXTURE_PATH: f.bare }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root && !document.getElementById('remoteImportButton').disabled);
  await t.test('empty startup, branch discovery, real clone, map choice and writing', async () => {
    assert.equal(await page.locator('#welcomePanel').isVisible(), true);
    await page.click('#remoteImportButton'); await page.fill('#remoteUrl', url); await page.click('#remoteBranchesButton');
    await page.waitForFunction(() => document.getElementById('remoteBranch').options.length === 3); await page.selectOption('#remoteBranch', 'main');
    await page.fill('#remoteName', 'mqtt-manual'); await page.click('#remoteImportForm button[type=submit]'); await page.waitForSelector('#remoteManualDialog[open]');
    assert.match(await page.locator('#remoteManual').innerText(), /MQTT 功能手册/); await page.click('#remoteManualForm button[type=submit]'); await page.waitForSelector('.map-topic-surface');
    assert.match(await page.locator('#documentTitle').innerText(), /MQTT 功能手册/); assert.match(await page.locator('#visualEditor').innerText(), /原始内容/); assert.equal(git(path.join(f.managed, 'mqtt-manual'), 'branch', '--show-current'), 'main');
  });
  await t.test('check leaves content intact; dirty buffers disable pulling; clean update reloads the Map', async () => {
    const before = await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current); await f.advance('新版远程正文');
    await page.click('#remoteUpdateButton'); await page.click('#remoteCheckButton'); await page.waitForFunction(() => !document.getElementById('remotePullButton').disabled);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), before);
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('a.dita'); a.setFileContent(file, file.current + '<!--未保存-->'); });
    assert.equal(await page.locator('#remotePullButton').isEnabled(), false); assert.match(await page.locator('#remoteUpdateStatus').innerText(), /未保存/);
    await page.evaluate(before => { const a = window.DitaApp; a.setFileContent(a.state.filesMap.get('a.dita'), before); }, before);
    await page.click('#remotePullButton'); await page.locator('.map-topic-surface').filter({ hasText: '新版远程正文' }).waitFor();
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
  });
  await t.test('disk changes block pulling and local-path addresses cannot create a library', async () => {
    const local = path.join(f.managed, 'mqtt-manual'); await fs.writeFile(path.join(local, 'untracked.dita'), '<topic>保留草稿</topic>');
    await page.click('#remoteUpdateButton'); await page.click('#remoteCheckButton'); await page.waitForFunction(() => document.getElementById('remoteUpdateStatus').textContent.includes('Git 工作区有改动'));
    assert.equal(await page.locator('#remotePullButton').isEnabled(), false); await page.click('#remoteUpdateCancel');
    await page.click('#remoteImportButton'); await page.fill('#remoteUrl', 'file:///tmp/manual'); await page.fill('#remoteName', 'bad'); await page.click('#remoteImportForm button[type=submit]');
    await page.waitForFunction(() => document.getElementById('remoteImportError').textContent.length > 0); assert.match(await page.locator('#remoteImportError').innerText(), /HTTPS|SSH/); assert.equal((await fs.readdir(f.managed)).includes('bad'), false); await page.click('#remoteImportCancel');
    assert.equal(await fs.readFile(path.join(local, 'untracked.dita'), 'utf8'), '<topic>保留草稿</topic>');
  });
  await t.test('unsaved edits block import and static demonstrations explicitly disable remote controls', async () => {
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('a.dita'); a.setFileContent(file, file.current + '<!--draft-->'); });
    await page.click('#remoteImportButton'); await page.fill('#remoteUrl', url); await page.fill('#remoteName', 'should-not-clone'); await page.click('#remoteImportForm button[type=submit]');
    assert.match(await page.locator('#remoteImportError').innerText(), /未保存/); assert.equal((await fs.readdir(f.managed)).includes('should-not-clone'), false); await page.click('#remoteImportCancel');
    await page.evaluate(() => { const a = window.DitaApp; a.state.capabilities.remoteGit = false; a.events.emit('workspace:changed'); });
    assert.equal(await page.locator('#remoteImportButton').isEnabled(), false); assert.match(await page.locator('#remoteImportButton').getAttribute('title'), /在线演示/);
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('a.dita'); a.setFileContent(file, file.disk); a.state.capabilities.remoteGit = true; a.events.emit('workspace:changed'); });
  });
  await t.test('mobile remote loading form fits the viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.click('#sidebarToggleButton'); await page.click('#remoteImportButton');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.ok((await page.locator('#remoteImportDialog').boundingBox()).width <= 390); await page.click('#remoteImportCancel');
  });
  assert.deepEqual(errors, []);
});
