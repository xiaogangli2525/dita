'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('workspace shell preserves editing state across panels and delivery steps', async t => {
  const port = await new Promise(resolve => {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(() => resolve(value)); });
  });
  const server = spawn(process.execPath, ['scripts/dev-server.js', '--port', String(port)], {
    cwd: path.join(__dirname, '..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Demo server timeout')), 10000);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port);
  await page.waitForFunction(() => window.DitaApp?.state.root);

  await t.test('compact shell keeps titles readable and source mode directly reachable', async () => {
    assert.equal(await page.locator('#inspector').isVisible(), false);
    await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface');
    assert.match(await page.locator('#documentTitle').innerText(), /MQTT 应用指南/);
    assert.match(await page.locator('#tree').innerText(), /MQTT 功能概述/);
    assert.ok((await page.locator('#visualEditor').boundingBox()).height >= 560);
    assert.equal(await page.locator('#tabs').isVisible(), false);
    await page.click('#sourceButton'); assert.equal(await page.locator('#editor').isVisible(), true);
    await page.click('#visualButton'); await page.waitForSelector('.map-topic-surface');
  });
  await t.test('panels share one state, resize by keyboard and leave buffers intact', async () => {
    const contents = () => page.evaluate(() => [...window.DitaApp.state.filesMap].map(([path, file]) => [path, file.current]));
    const before = await contents();
    await page.click('#footnotesButton'); await page.waitForSelector('.footnote-card');
    assert.equal(await page.locator('#footnotesButton').getAttribute('aria-expanded'), 'true');
    await page.click('#propertiesTab');
    assert.equal(await page.locator('#footnotesPanel').isVisible(), false);
    const width = (await page.locator('#inspector').boundingBox()).width;
    await page.locator('#inspectorResize').focus(); await page.keyboard.press('ArrowLeft');
    assert.equal((await page.locator('#inspector').boundingBox()).width, width + 16);
    await page.setViewportSize({ width: 1101, height: 768 });
    await page.locator('#inspectorResize').focus(); await page.keyboard.press('End');
    const pane = await page.locator('#visualPane').boundingBox();
    const action = await page.locator('#newFootnoteButton').boundingBox();
    assert.ok(action.x + action.width <= pane.x + pane.width, 'resizing must keep writing actions reachable');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.click('#inspectorCloseButton');
    assert.equal(await page.locator('#inspectorToggleButton').getAttribute('aria-expanded'), 'false');
    await page.click('#reviewButton');
    assert.equal(await page.locator('#reviewPane').isVisible(), true);
    assert.equal(await page.locator('#visualEditor').getAttribute('contenteditable'), 'false');
    await page.click('#inspectorCloseButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'visual');
    assert.equal(await page.locator('#inspector').isVisible(), false);
    assert.deepEqual(await contents(), before);
  });
  await t.test('current document save status excludes unrelated dirty buffers', async () => {
    await page.evaluate(async () => {
      const a = window.DitaApp;
      await a.openFile('topics/mqtt-overview.dita');
      const other = a.state.filesMap.get('topics/mqtt-publish.dita');
      a.setFileContent(other, other.current + '<!--pending-->');
    });
    assert.equal(await page.locator('#documentSaveState').getAttribute('data-state'), 'saved');
    await page.evaluate(() => window.DitaApp.openFile('main.ditamap'));
    await page.waitForSelector('.map-topic-surface');
    assert.equal(await page.locator('#documentSaveState').getAttribute('data-state'), 'dirty');
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('topics/mqtt-publish.dita'); a.setFileContent(file, file.disk); });
  });
  await t.test('delivery preflight enables export and changing configuration invalidates it', async () => {
    await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
    assert.equal(await page.locator('[data-delivery-step="export"]').isDisabled(), true);
    await page.click('#modelExportForm [value=check]');
    await page.waitForFunction(() => document.getElementById('deliveryCheckStatus').textContent.includes('检查通过'));
    assert.equal(await page.locator('#deliveryReady').isVisible(), true);
    await page.click('[data-delivery-step="configure"]'); await page.fill('#exportVersion', 'V2');
    assert.equal(await page.locator('[data-delivery-step="export"]').isDisabled(), true);
    assert.doesNotMatch(await page.locator('#deliveryCheckStatus').textContent(), /检查通过/);
    await page.click('#modelExportForm [value=check]');
    await page.waitForFunction(() => document.getElementById('deliveryCheckStatus').textContent.includes('检查通过'));
    await page.evaluate(() => {
      const a = window.DitaApp, file = a.state.filesMap.get('topics/mqtt-publish.dita');
      a.setFileContent(file, file.current + '<!--new revision-->');
    });
    await page.click('#modelExportForm [value=preview]');
    assert.match(await page.locator('#modelExportError').innerText(), /内容已变化/);
    assert.equal(await page.locator('#deliveryReady').isVisible(), false);
    await page.click('#modelExportCancel');
    await page.evaluate(() => { const a = window.DitaApp, file = a.state.filesMap.get('topics/mqtt-publish.dita'); a.setFileContent(file, file.disk); });
  });
  await t.test('Escape inside a dialog preserves the underlying notes panel', async () => {
    await page.click('#footnotesButton'); await page.waitForSelector('.footnote-card');
    await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modelExportDialog').isVisible(), false);
    assert.equal(await page.locator('#footnotesPanel').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#inspector').isVisible(), false);
  });
  await t.test('narrow viewport keeps navigation and panels reachable without horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const pane = await page.locator('#visualPane').boundingBox();
    const insert = await page.locator('#newFootnoteButton').boundingBox();
    assert.ok(insert.x + insert.width <= pane.x + pane.width, 'writing actions must not be clipped by the pane');
    await page.click('#sidebarToggleButton');
    assert.equal(await page.locator('#repositorySelect').isVisible(), true);
    await page.click('#tree button[data-path="topics/mqtt-overview.dita"]');
    assert.equal(await page.locator('#workspaceSidebar').isVisible(), false);
    await page.click('#footnotesButton');
    assert.ok((await page.locator('#inspector').boundingBox()).width <= 340);
    await page.click('#inspectorCloseButton');
    assert.equal(await page.locator('#footnotesButton').getAttribute('aria-expanded'), 'false');
  });
  assert.deepEqual(errors, []);
});
