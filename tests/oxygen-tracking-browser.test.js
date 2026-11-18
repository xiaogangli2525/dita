'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core'), iconv = require('iconv-lite');
const tracking = require('../public/oxygen-tracking');

test('Oxygen tracking persists real code edits and supports review, history and Map scope', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-oxygen-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep-->\r\n<topic id="a"><title>HTTP</title><body><p id="plain">原始说明</p><codeblock id="code">AT+OPEN\r\n    TIMEOUT=30\r\n    AT+SEND &amp; OK</codeblock><table><tgroup cols="1"><tbody><row><entry id="param">范围 30</entry></row></tbody></tgroup></table></body></topic>\r\n<?tail keep?>';
  const other = '<topic id="b"><title>TCP</title><body><codeblock id="other-code">OPEN</codeblock></body></topic>';
  const prose = '<topic id="typing"><title>Typing</title><body><p id="typing-p">Old prose with a rejection baseline.</p></body></topic>';
  const map = '<map><title>功能手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>';
  await fs.writeFile(path.join(repo, 'a.dita'), iconv.encode(original, 'gbk')); await fs.writeFile(path.join(repo, 'b.dita'), other); await fs.writeFile(path.join(repo, 'main.ditamap'), map);
  await fs.writeFile(path.join(repo, 'typing.dita'), prose);
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const number = socket.address().port; socket.close(() => resolve(number)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const current = (name = 'a.dita') => page.evaluate(name => window.DitaApp.state.filesMap.get(name).current, name);
  async function open(name) { await page.evaluate(name => window.DitaApp.openFile(name), name); await page.waitForFunction(name => window.DitaApp.state.activePath === name, name); }
  async function configure(on) {
    await page.click('#trackingButton'); await page.locator('#trackingEnabled').setChecked(on); await page.fill('#trackingAuthor', '研发 & QA');
    await page.click('#trackingForm button[type=submit]'); await page.waitForFunction(() => !document.getElementById('trackingDialog').open);
  }
  async function select(selector, begin, end = begin) {
    await page.locator(selector).click();
    await page.evaluate(({ selector, begin, end }) => {
      const block = document.querySelector(selector);
      function point(offset) { const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; } return [block, block.childNodes.length]; }
      const range = document.createRange(); range.setStart(...point(begin)); range.setEnd(...point(end)); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, { selector, begin, end });
  }
  await open('a.dita');
  let revision;
  await t.test('enabling requires an author and tracks real code replacements without saving automatically', async () => {
    await page.click('#trackingButton'); await page.check('#trackingEnabled'); await page.click('#trackingForm button[type=submit]');
    assert.match(await page.locator('#trackingError').textContent(), /修订作者/); await page.fill('#trackingAuthor', '研发 & QA'); await page.click('#trackingForm button[type=submit]');
    const text = await page.locator('#code').textContent(), at = text.indexOf('30'); await select('#code', at, at + 2); await page.keyboard.insertText('60');
    revision = await current(); assert.match(revision, /oxy_delete/); assert.match(revision, /oxy_insert_start/); assert.match(revision, /author="研发 &amp; QA"/);
    assert.equal(tracking.resolve(revision, false), tracking.setEnabled(original, true));
    assert.equal(tracking.resolve(revision, true), tracking.setEnabled(original.replace('30\r\n', '60\r\n'), true));
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), original);
  });
  await t.test('save and reload retain native PI records, GBK and code whitespace; source remains read-only', async () => {
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty);
    assert.equal(iconv.decode(await fs.readFile(path.join(repo, 'a.dita')), 'gbk'), revision);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await open('a.dita');
    assert.equal(await current(), revision); assert.equal(await page.locator('#trackingButton').getAttribute('aria-pressed'), 'true');
    await page.click('#sourceButton'); assert.equal(await page.locator('#editor').getAttribute('readonly') !== null, true); await page.click('#visualButton');
  });
  await t.test('code review highlights exact old/new text in place and blocks delivery before review', async () => {
    await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen');
    assert.equal(await page.locator('#code .oxy-delete').textContent(), '3'); assert.equal(await page.locator('#code .oxy-insert').textContent(), '6');
    assert.equal(await page.locator('#code').textContent(), 'AT+OPEN\n    TIMEOUT=360\n    AT+SEND & OK');
    assert.equal(await page.locator('#code [data-review-decoration]').count(), 0);
    const error = await page.evaluate(async () => { const A = window.DitaApp, snapshot = await A.manual.capture('a.dita'); try { A.manual.prepare(snapshot); return ''; } catch (error) { return error.message; } });
    assert.match(error, /Oxygen 修订/);
  });
  await t.test('reject restores the full original code, undo restores revisions and accept keeps the new code', async () => {
    await page.click('#rejectAllButton'); assert.equal(await current(), tracking.setEnabled(original, true));
    await page.evaluate(() => document.getElementById('undoButton').click()); assert.equal(await current(), revision);
    await page.click('#acceptAllButton'); assert.equal(await current(), tracking.setEnabled(original.replace('30\r\n', '60\r\n'), true));
    await page.click('#closeReviewButton');
  });
  await t.test('continuous typing, code Enter and Tab retain a rejectable original; structural edits fail without mutation', async () => {
    await select('#code', (await page.locator('#code').textContent()).length); await page.keyboard.type('XY'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.insertText('新代码😀');
    const value = await current(); assert.ok(tracking.resolve(value, true).includes('    AT+SEND &amp; OKX\r\n        新代码😀'));
    assert.equal(tracking.resolve(value, false), tracking.setEnabled(original.replace('30\r\n', '60\r\n'), true));
    await select('#plain', 2); await page.keyboard.press('Enter'); assert.equal(await current(), value); assert.match(await page.locator('#status').textContent(), /第一版/);
  });
  await t.test('Map tracking covers Topic buffers and keeps their histories independent', async () => {
    await open('main.ditamap'); await page.waitForSelector('[data-map-topic-path="b.dita"] #other-code'); await configure(true);
    await select('#other-code', 4); await page.keyboard.type(' X'); const changed = await current('b.dita'); assert.match(changed, /oxy_insert_start/);
    assert.equal(tracking.resolve(changed, false), tracking.setEnabled(other, true));
    await page.click('#authorUndoButton'); assert.equal(await current('b.dita'), other); await page.click('#authorRedoButton'); assert.equal(await current('b.dita'), changed);
    await configure(false); await select('#other-code', 6); await page.keyboard.type('!'); const off = await current('b.dita');
    assert.equal(tracking.resolve(off, false).includes('OPEN!'), true);
  });
  await t.test('Map bulk rejection validates every restored file before changing any buffer', async () => {
    await page.evaluate(() => {
      const A = window.DitaApp, file = A.state.filesMap.get('b.dita');
      A.setFileContent(file, file.current.replace('</body>', '<?oxy_delete author="QA" content="&lt;p&gt;unfinished"?></body>'), { origin: 'restore' });
    });
    await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen');
    const before = await page.evaluate(() => [...window.DitaApp.state.filesMap].map(([path, file]) => [path, file.current]));
    await page.click('#rejectAllButton');
    assert.match(await page.locator('#status').textContent(), /无法批量应用修订/);
    assert.deepEqual(await page.evaluate(() => [...window.DitaApp.state.filesMap].map(([path, file]) => [path, file.current])), before);
  });
  await t.test('prose keeps synchronizing after real keyboard spaces, Unicode, save and reload', async () => {
    await page.click('#closeReviewButton'); await open('typing.dita'); await configure(true);
    await select('#typing-p', 0, 'Old prose with a rejection baseline.'.length);
    await page.keyboard.type('HTTP request timeout 60 seconds ');
    await page.keyboard.insertText('中文 😀');
    const revision = await current('typing.dita');
    assert.equal(tracking.resolve(revision, false), tracking.setEnabled(prose, true));
    assert.match(tracking.resolve(revision, true).replace(/\u00a0/g, ' '), /HTTP request timeout 60 seconds 中文 😀/);
    assert.doesNotMatch(await page.locator('#status').textContent(), /同步失败|空白结构较复杂/);
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('typing.dita').dirty);
    assert.equal(await fs.readFile(path.join(repo, 'typing.dita'), 'utf8'), revision);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await open('typing.dita');
    assert.equal(await current('typing.dita'), revision);
    assert.equal((await page.locator('#typing-p').textContent()).replace(/\u00a0/g, ' '), 'HTTP request timeout 60 seconds 中文 😀');
  });
  await t.test('native Chromium composition commits tracked Chinese once and cancellation keeps history untouched', async () => {
    const initial = await current('typing.dita'), initialText = await page.locator('#typing-p').textContent();
    const offset = initialText.length;
    const depth = () => page.evaluate(() => window.DitaApp.state.filesMap.get('typing.dita').history.undo.length);
    await select('#typing-p', offset);
    const before = await depth(), cdp = await page.context().newCDPSession(page);
    try {
      const compose = text => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await compose('zh'); await compose('zhong');
      assert.equal(await current('typing.dita'), initial);
      assert.equal(await depth(), before);
      await compose('');
      assert.equal(await current('typing.dita'), initial);
      assert.equal(await page.locator('#typing-p').textContent(), initialText);
      assert.equal(await depth(), before);
      await compose('zh'); await compose('zhong');
      assert.equal(await current('typing.dita'), initial);
      await cdp.send('Input.insertText', { text: '中' });
      await page.waitForFunction(() => window.DitaOxygenTracking.resolve(window.DitaApp.state.filesMap.get('typing.dita').current, true).includes('😀中'));
      const changed = await current('typing.dita');
      assert.equal(await depth(), before + 1);
      assert.doesNotMatch(changed, /zhong/);
      assert.equal(tracking.resolve(changed, false), tracking.setEnabled(prose, true));
      await page.keyboard.press('Control+z'); assert.equal(await current('typing.dita'), initial);
      await page.keyboard.press('Control+y'); assert.equal(await current('typing.dita'), changed);
    } finally { await cdp.detach(); }
  });
  assert.deepEqual(errors, []);
});
