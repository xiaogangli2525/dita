'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('real browser editing, reading and review workflow', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-browser-'));
  const root = path.join(temporary, 'docs');
  await fs.mkdir(root);
  const initial = '<topic id="a"><title>Title</title><body><p>Original</p></body></topic>';
  const deleted = '<p>' + 'deleted content '.repeat(40) + '</p>';
  const oxygen = '<topic id="oxy"><title>Oxygen</title><body><p><?oxy_insert_start author="A"?>Inserted<?oxy_insert_end?></p><?oxy_delete author="A" content="' + deleted.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"?></body></topic>';
  await fs.writeFile(path.join(root, 'a.dita'), initial);
  await fs.writeFile(path.join(root, 'oxy.dita'), oxygen);
  await fs.writeFile(path.join(root, 'main.ditamap'), '<map><title>Map</title><topicref href="a.dita"/><topicref href="oxy.dita"/></map>');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: root, REPOSITORIES_ROOT: temporary, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (child.exitCode == null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 10000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('error', reject);
  });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const writes = [];
  page.on('request', request => { if (/\/api\/file$/.test(request.url()) && ['PUT', 'POST'].includes(request.method())) writes.push(request.url()); });
  await page.goto('http://127.0.0.1:' + port);
  await page.waitForFunction(() => window.DitaApp?.state.root);
  const open = async file => {
    await page.click('[data-view="search"]');
    await page.fill('#workspaceSearchInput', file);
    await page.locator('.workspace-result').filter({ hasText: file }).click();
    await page.waitForFunction(file => window.DitaApp.state.activePath === file, file);
  };
  const current = () => page.evaluate(() => { const a = window.DitaApp; return a.state.filesMap.get(a.state.activePath).current; });
  const source = async text => { await page.click('#sourceButton'); await page.fill('#editor', text); };
  const undo = async () => { await page.click('#sourceButton'); await page.focus('#editor'); await page.keyboard.press('Control+z'); };

  await t.test('reading is read-only for a Topic and every Map surface', async () => {
    await open('a.dita');
    await page.click('#previewButton');
    assert.equal(await page.locator('#visualEditor').getAttribute('contenteditable'), 'false');
    await page.locator('#visualEditor p').click(); await page.keyboard.type('should not edit');
    assert.equal(await current(), initial);
    await open('main.ditamap'); await page.click('#previewButton');
    await page.waitForSelector('.map-topic-surface');
    assert.equal(await page.locator('#visualEditor [contenteditable="true"]').count(), 0);
    assert.equal(writes.length, 0);
  });
  await t.test('Chinese visual input and pasted text share undo/redo', async () => {
    await open('a.dita'); await page.click('#visualButton');
    await page.locator('#visualEditor p').click(); await page.keyboard.press('End');
    await page.keyboard.insertText('中文输入');
    assert.match(await current(), /中文输入/);
    await page.keyboard.press('Control+z'); assert.equal(await current(), initial);
    await page.keyboard.press('Control+y'); assert.match(await current(), /中文输入/);
    await page.locator('#visualEditor p').click(); await page.keyboard.press('End');
    await page.evaluate(() => navigator.clipboard.writeText(' pasted text'));
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.DitaApp.state.filesMap.get('a.dita').current.includes('pasted text'));
    await page.keyboard.press('Control+z'); assert.doesNotMatch(await current(), /pasted text/);
  });
  await t.test('formatting preserves code indentation, inline spaces, encoding and outer comments', async () => {
    const code = '<codeblock>if ok:\n    if ready:\n        run()</codeblock>';
    const content = '<?xml version="1.0" encoding="GBK"?>\n<!--keep-->\n<topic id="a"><title>T</title><body>' + code + '<p><b>A</b> <i>B</i></p></body></topic>\n<?end test?>';
    await source(content);
    await page.click('.editing-tools summary'); await page.click('#formatButton');
    const result = await current();
    assert.ok(result.includes(code)); assert.ok(result.includes('<b>A</b> <i>B</i>'));
    assert.ok(result.startsWith('<?xml version="1.0" encoding="GBK"?>\n<!--keep-->'));
    assert.ok(result.endsWith('<?end test?>'));
    await undo(); assert.equal(await current(), content);
  });
  await t.test('table row editing uses the same undo history', async () => {
    const table = '<topic id="a"><title>Table</title><body><table><tgroup cols="2"><tbody><row><entry>A</entry><entry>B</entry></row></tbody></tgroup></table></body></topic>';
    await source(table); await page.click('#visualButton');
    await page.locator('#visualEditor td').first().click();
    await page.click('[data-context-action="row-after"]');
    assert.equal((await current()).match(/<row/g).length, 2);
    await undo(); assert.equal(await current(), table);
    await page.click('#visualButton'); await page.locator('#visualEditor td').first().click();
    await page.click('[data-context-action="col-after"]');
    assert.match(await current(), /cols="3"/);
    assert.equal((await current()).match(/<entry/g).length, 3);
    await undo(); assert.equal(await current(), table);
  });
  await t.test('Git bulk rejection stays unsaved, undoable and keeps the Git baseline', async () => {
    const changed = initial.replace('Original', 'Saved change');
    await source(changed); await page.click('#saveButton');
    await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty);
    const before = writes.length;
    await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'git');
    await page.click('#rejectAllButton');
    assert.equal(await current(), initial);
    assert.equal(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), changed);
    assert.equal(writes.length, before);
    await undo(); assert.equal(await current(), changed);
    await page.click('#reviewButton'); await page.click('#acceptAllButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').baseline), initial);
    assert.equal(writes.length, before);
  });
  await t.test('Oxygen-only bulk actions work and restore the complete deletion', async () => {
    await open('oxy.dita'); await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen');
    assert.equal(await page.locator('#rejectAllButton').isEnabled(), true);
    const before = writes.length;
    await page.click('#rejectAllButton');
    assert.ok((await current()).includes(deleted)); assert.doesNotMatch(await current(), /oxy_insert|oxy_delete|Inserted/);
    assert.equal(writes.length, before); assert.equal(await fs.readFile(path.join(root, 'oxy.dita'), 'utf8'), oxygen);
    await undo(); assert.equal(await current(), oxygen);
    await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen'); await page.click('#acceptAllButton');
    assert.match(await current(), /Inserted/); assert.doesNotMatch(await current(), /oxy_insert|oxy_delete|deleted content/);
    await undo(); assert.equal(await current(), oxygen);
  });
  await t.test('Map bulk rejection preserves files until explicit Save', async () => {
    await open('main.ditamap'); await page.click('#reviewButton');
    await page.waitForSelector('.map-topic-surface'); await page.selectOption('#reviewScope', 'git');
    const before = writes.length;
    await page.click('#rejectAllButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), initial);
    assert.match(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), /Saved change/);
    assert.equal(writes.length, before);
    await page.click('#saveButton');
    await page.waitForFunction(() => Array.from(window.DitaApp.state.filesMap.values()).every(file => !file.dirty));
    assert.equal(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), initial);
  });
  if (process.env.DITA_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.DITA_BROWSER_SCREENSHOT });
  await t.test('390px layout remains contained', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });
  assert.deepEqual(errors, []);
});
