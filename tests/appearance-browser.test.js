'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs/promises'), net = require('node:net');
const { spawn } = require('node:child_process'), { chromium } = require('playwright-core');

test('workspace appearance switches without editing or changing customer delivery', async t => {
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
  const server = spawn(process.execPath, ['scripts/dev-server.js', '--docs', 'tests/fixtures/writing-demo', '--port', String(port)], { cwd: path.join(__dirname, '..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const errors = [];
  async function fresh(st, options = {}) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options }); st.after(() => page.close());
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000); return page;
  }
  const ready = async page => { await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root); };
  const choose = (page, name) => page.locator('.theme-choice').filter({ has: page.locator('input[value="' + name + '"]') }).click();
  const theme = page => page.locator('html').getAttribute('data-theme');

  await t.test('all presets cover shell, document and controls with readable semantic colors', async st => {
    const page = await fresh(st); await ready(page); await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface');
    await page.click('#appearanceButton'); assert.equal(await page.getByRole('radio').count(), 5);
    for (const value of ['forest', 'blue', 'paper', 'dark']) {
      await choose(page, value); assert.equal(await theme(page), value);
      const checks = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const rgb = token => { const probe = document.createElement('span'); probe.style.color = 'var(' + token + ')'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color.match(/[\d.]+/g).slice(0, 3).map(Number); };
        const light = color => color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        const pairs = [['--text', '--panel'], ['--muted', '--panel'], ['--accent', '--accent-soft'], ['--on-accent', '--accent'], ['--paper-ink', '--paper'], ['--paper-muted', '--paper'], ['--code-ink', '--code-bg'], ['--warning', '--warning-soft'], ['--danger', '--danger-soft'], ['--success', '--success-soft']];
        return { scheme: style.colorScheme, colors: pairs.map(([ink, background]) => { const a = light(rgb(ink)), b = light(rgb(background)); return { ink, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; }) };
      });
      assert.equal(checks.scheme, value === 'dark' ? 'dark' : 'light');
      for (const check of checks.colors) assert.ok(check.ratio >= 4.5, value + ' ' + JSON.stringify(check));
    }
    await page.click('#appearanceClose'); assert.equal(await page.locator('#appearanceButton').evaluate(node => node === document.activeElement), true);
  });

  await t.test('changing appearance preserves unsaved XML, undo, source selection and scroll', async st => {
    const page = await fresh(st); await ready(page);
    await page.evaluate(async () => { const a = window.DitaApp; await a.openFile('topics/mqtt-overview.dita'); a.setMode('editor'); const f = a.state.filesMap.get(a.state.activePath); a.setFileContent(f, f.current + '\n<!-- THEME_UNSAVED -->'); a.dom.editor.focus(); a.dom.editor.setSelectionRange(8, 14); a.dom.editor.scrollTop = 20; });
    const read = () => page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get(a.state.activePath); return { current: f.current, disk: f.disk, baseline: f.baseline, undo: f.history.undo.length, dirty: f.dirty, start: a.dom.editor.selectionStart, end: a.dom.editor.selectionEnd, scroll: a.dom.editor.scrollTop }; });
    const before = await read();
    // Use the menu entry: closing it focuses the View menu, not a different document.
    await page.click('[data-menu=view]'); await page.getByRole('menuitem', { name: '界面外观', exact: true }).click();
    await choose(page, 'paper'); await page.keyboard.press('Escape'); assert.deepEqual(await read(), before);
    await page.evaluate(() => document.getElementById('editor').focus()); await page.click('#appearanceButton'); await choose(page, 'dark'); await page.click('#appearanceClose'); await page.waitForFunction(before => document.activeElement.id === 'editor' && document.activeElement.selectionStart === before.start && document.activeElement.selectionEnd === before.end, before); assert.deepEqual(await read(), before);
    await page.evaluate(() => window.DitaApp.setMode('visual'));
    const paragraph = page.locator('#visualEditor [data-dita-source="p"]').first(); await paragraph.click(); await page.keyboard.press('End');
    const selection = () => page.evaluate(() => { const s = getSelection(); return { text: s.anchorNode?.textContent, offset: s.anchorOffset }; });
    const original = await selection(); await page.click('#appearanceButton'); await choose(page, 'blue'); await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement.id === 'visualEditor'); assert.deepEqual(await selection(), original);
  });

  await t.test('saved choice restores on reload and system changes only affect automatic mode', async st => {
    const page = await fresh(st); await ready(page); await page.click('#appearanceButton'); await choose(page, 'dark'); await page.click('#appearanceClose');
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); assert.equal(await theme(page), 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); await page.click('#appearanceButton'); await choose(page, 'system'); assert.equal(await theme(page), 'forest');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await theme(page), 'dark'); assert.equal(await page.locator('[value=system]').isChecked(), true);
    await choose(page, 'paper'); await page.emulateMedia({ colorScheme: 'light' }); assert.equal(await theme(page), 'paper');
  });

  await t.test('storage denial still allows appearance changes without blocking initialization', async st => {
    const page = await fresh(st); await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('unavailable'); } }));
    await ready(page); await page.click('#appearanceButton'); await choose(page, 'dark'); assert.equal(await theme(page), 'dark'); assert.match(await page.locator('#appearanceHint').innerText(), /本次/);
  });

  await t.test('narrow dialog supports keyboard choice, scrolling, visible completion and Escape', async st => {
    const page = await fresh(st, { viewport: { width: 390, height: 520 } }); await ready(page); await page.click('#appearanceButton');
    assert.equal(await page.evaluate(() => document.activeElement.value), 'forest'); await page.keyboard.press('ArrowRight'); assert.equal(await theme(page), 'blue');
    await choose(page, 'system'); await page.locator('#appearanceDialog').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const bounds = await page.locator('#appearanceClose').boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height < 520);
    assert.ok(await page.locator('#appearanceDialog').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#appearanceDialog').isVisible(), false); assert.equal(await page.locator('#appearanceButton').evaluate(node => node === document.activeElement), true);
  });

  await t.test('HTML delivery bytes stay identical across skins', async st => {
    const page = await fresh(st); await ready(page); await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface');
    const contents = [];
    for (const value of ['forest', 'dark']) {
      await page.click('#appearanceButton'); await choose(page, value); await page.click('#appearanceClose');
      await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
      const pending = page.waitForEvent('download'); await page.click('#modelExportForm [value=download]'); const download = await pending;
      contents.push(await fs.readFile(await download.path(), 'utf8'));
    }
    assert.equal(contents[0], contents[1]); assert.doesNotMatch(contents[1], /data-theme=|theme-preference\.js|var\(--paper/);
  });
  assert.deepEqual(errors, []);
});
