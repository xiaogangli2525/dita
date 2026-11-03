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
  const server = spawn(process.execPath, ['scripts/dev-server.js', '--docs', 'tests/fixtures/writing-demo', '--port', String(port)], {
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
    await page.locator('#inspectorResize').focus(); await page.keyboard.press('End');
    await page.setViewportSize({ width: 1101, height: 768 });
    assert.equal(await page.locator('#inspector').evaluate(node => getComputedStyle(node).position), 'fixed');
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
  await t.test('navigation width supports dragging and keyboard adjustment, persists and adapts to the viewport', async () => {
    const nav = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    try {
      nav.on('pageerror', error => errors.push(error.message));
      await nav.goto('http://127.0.0.1:' + port); await nav.waitForFunction(() => window.DitaApp?.state.root);
      const handle = nav.locator('#sidebarResize'), width = async () => (await nav.locator('#workspaceSidebar').boundingBox()).width;
      const initial = await width(); assert.ok(initial >= 280, 'default navigation should have room for document titles');
      await handle.focus(); await nav.keyboard.press('ArrowRight'); assert.equal(await width(), initial + 16);
      const box = await handle.boundingBox(); await nav.mouse.move(box.x + box.width / 2, box.y + 70); await nav.mouse.down(); await nav.mouse.move(box.x + box.width / 2 + 32, box.y + 70); await nav.mouse.up();
      const preferred = await width(); assert.equal(preferred, initial + 48);
      assert.equal(await nav.locator('body').evaluate(node => node.classList.contains('resizing-navigation')), false);
      await nav.reload(); await nav.waitForFunction(() => window.DitaApp?.state.root); assert.equal(await width(), preferred);
      await nav.setViewportSize({ width: 760, height: 768 }); await nav.waitForFunction(() => Number(document.getElementById('sidebarResize').getAttribute('aria-valuenow')) <= Math.floor(innerWidth * .42)); assert.ok(await width() <= Math.floor(760 * .42));
      assert.ok((await nav.locator('.content').boundingBox()).width >= 380);
      await nav.setViewportSize({ width: 1366, height: 768 }); await nav.waitForFunction(value => Number(document.getElementById('sidebarResize').getAttribute('aria-valuenow')) === value, preferred); assert.equal(await width(), preferred, 'restore the preferred width after a temporary small viewport');
      await handle.focus(); await nav.keyboard.press('Home'); assert.equal(await width(), Number(await handle.getAttribute('aria-valuemin')));
      await nav.keyboard.press('End'); assert.equal(await width(), Number(await handle.getAttribute('aria-valuemax')));
      await handle.dblclick(); assert.equal(await width(), initial);
      await nav.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage is disabled'); } }); });
      await nav.reload(); await nav.waitForFunction(() => window.DitaApp?.state.root);
      await handle.focus(); await nav.keyboard.press('ArrowRight'); assert.equal(await width(), initial + 16, 'resizing should work when preference storage is unavailable');
    } finally { await nav.close(); }
  });
  await t.test('long nested document titles wrap and filters explain empty results', async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const original = await page.evaluate(() => window.DitaApp.state.maps.find(map => map.path === window.DitaApp.state.selectedMap).children);
    try {
      await page.evaluate(() => {
        const a = window.DitaApp, title = '通信模组 MQTT 建立安全连接与多型号固件兼容性说明 '.repeat(4);
        let node = { type: 'file', title, path: 'topics/long-title-compatibility.dita', sourcePath: 'test.leaf' };
        for (let i = 0; i < 6; i++) node = { type: 'container', title: '功能分组 ' + i, sourcePath: 'test.' + i, children: [node] };
        a.session.upsertMap({ ...a.state.maps.find(map => map.path === a.state.selectedMap), children: [node] }); a.maps.updateTree();
      });
      const label = page.locator('#tree .map-node-label').last();
      assert.ok((await label.boundingBox()).height > 40, 'long titles should wrap rather than disappear into an ellipsis');
      assert.equal(await page.locator('#tree').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await page.fill('#search', 'no_such_manual_ui_audit'); assert.match(await page.locator('#tree [role=status]').innerText(), /没有匹配/);
      await page.fill('#search', '兼容性'); assert.equal(await label.isVisible(), true);
      assert.equal(await page.locator('#mapSelect').getAttribute('title'), await page.locator('#mapSelect option:checked').innerText());
    } finally {
      await page.evaluate(children => { const a = window.DitaApp; a.session.upsertMap({ ...a.state.maps.find(map => map.path === a.state.selectedMap), children }); a.maps.updateTree(''); }, original);
      await page.fill('#search', '');
    }
  });
  await t.test('short windows keep tree, file search and workspace controls reachable', async () => {
    await page.setViewportSize({ width: 1100, height: 520 });
    await page.click('.map-structure-tools summary');
    await page.locator('#tree button').last().scrollIntoViewIfNeeded();
    const tree = await page.locator('#tree button').last().boundingBox(), view = await page.locator('#mapView').boundingBox();
    assert.ok(tree.y + tree.height <= view.y + view.height + 1, 'scroll the navigation rather than clipping its last row');
    const settings = await page.locator('.workspace-settings').boundingBox(), aside = await page.locator('#workspaceSidebar').boundingBox();
    assert.ok(settings.y >= aside.y && settings.y + settings.height <= aside.y + aside.height + 1);
    assert.ok((await page.locator('#repositorySelect').boundingBox()).width >= 180, 'workspace names use a full row');
    await page.getByRole('tab', { name: '文件查找', exact: true }).click();
    await page.fill('#contentSearchInput', 'MQTT'); await page.click('#contentSearchButton');
    await page.waitForFunction(() => /个结果/.test(document.getElementById('contentSearchMeta').textContent));
    assert.ok(await page.locator('.content-search-result').count() > 0);
    assert.equal(await page.locator('#searchView').evaluate(node => node.scrollHeight > node.clientHeight), true);
    await page.locator('#contentSearchMeta').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('tab', { name: '文档', exact: true }).click(); await page.click('.map-structure-tools summary');
  });
  await t.test('mobile navigation has an explicit close control, backdrop and contained keyboard focus', async () => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.click('#sidebarToggleButton');
    assert.equal(await page.locator('#sidebarCloseButton').isVisible(), true);
    assert.equal(await page.locator('#sidebarResize').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebarCloseButton');
    await page.locator('#newDocumentButton').focus(); await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'releasesButton');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'newDocumentButton');
    await page.click('#sidebarCloseButton'); assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebarToggleButton');
    assert.equal(await page.locator('#workspaceSidebar').isVisible(), false);
    await page.click('#sidebarToggleButton'); const box = await page.locator('#workspaceSidebar').boundingBox();
    await page.mouse.click(box.x + box.width + 10, box.y + 70); assert.equal(await page.locator('#workspaceSidebar').isVisible(), false);
    await page.click('#sidebarToggleButton'); await page.keyboard.press('Escape'); assert.equal(await page.locator('#sidebarToggleButton').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#sidebarBackdrop').isVisible(), false);
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await page.locator('#workspaceSidebar').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  assert.deepEqual(errors, []);
});
