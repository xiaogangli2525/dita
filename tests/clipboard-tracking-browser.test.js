'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core');
const tracking = require('../public/oxygen-tracking');

test('clipboard code boundaries, HTML fallback and tracked edits preserve source and history', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-clipboard-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = '<topic id="t"><title>粘贴验收</title><body>\n<p id="p">原始正文</p>\n<ul><li id="item">原始列表</li></ul>\n<table><tgroup cols="1"><tbody><row><entry id="cell">原始单元格</entry></row></tbody></tgroup></table>\n<codeblock id="code">AT+OLD\n    KEEP\n</codeblock>\n<codeblock id="second">SECOND</codeblock>\n<p id="protected">正文<fn id="fn">保留注脚</fn>末尾</p>\n</body></topic>';
  await fs.writeFile(path.join(repo, 'paste.dita'), original);
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'Synthetic clipboard baseline']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }), page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  await page.evaluate(() => window.DitaApp.openFile('paste.dita'));
  const current = () => page.evaluate(() => window.DitaApp.state.filesMap.get('paste.dita').current);
  const undo = () => page.click('#authorUndoButton');
  async function select(selector, begin = 0, end = begin) {
    await page.locator(selector).click();
    await page.evaluate(({ selector, begin, end }) => {
      const block = document.querySelector(selector);
      const point = offset => { const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; } return [block, block.childNodes.length]; };
      const range = document.createRange(); range.setStart(...point(begin)); range.setEnd(...point(end)); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, { selector, begin, end });
  }
  async function wholeCode() {
    await page.locator('#code').click();
    await page.evaluate(() => { const range = document.createRange(); range.selectNode(document.getElementById('code')); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  }
  async function paste(text, html = '') {
    await page.evaluate(async ({ text, html }) => { const item = { 'text/plain': new Blob([text], { type: 'text/plain' }) }; if (html) item['text/html'] = new Blob([html], { type: 'text/html' }); await navigator.clipboard.write([new ClipboardItem(item)]); }, { text, html });
    await page.keyboard.press('Control+v');
  }
  await t.test('whole codeblock replacement accepts parent boundary positions and preserves adjacent blocks', async () => {
    await wholeCode(); await paste('AT+NEW\r\n\tINDENT\r\n\r\n中文 😀 & <OK>\r\n');
    assert.equal(await page.locator('#code').textContent(), 'AT+NEW\n\tINDENT\n\n中文 😀 & <OK>\n');
    assert.equal(await page.locator('#second').textContent(), 'SECOND'); assert.equal(await page.locator('#code').count(), 1);
    assert.match(await page.locator('#status').textContent(), /已粘贴代码/);
    await undo(); assert.equal(await current(), original);
  });
  await t.test('HTML-only code paste retains line breaks, table cells, escaping and excludes active content', async () => {
    for (const [html, expected] of [
      ['<pre><code>A &amp; B\n\tC &lt;OK&gt;\n</code></pre>', 'A & B\n\tC <OK>\n'],
      ['<div>FIRST</div><div>  SECOND<br>THIRD</div><script>BAD_SCRIPT</script>', 'FIRST\n  SECOND\nTHIRD'],
      ['<div>FIRST</div><div><br></div><div>LAST</div>', 'FIRST\n\nLAST'],
      ['<div></div><div>FIRST</div><div></div>', '\nFIRST\n'],
      ['<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>', 'A\tB\nC\tD']
    ]) {
      await wholeCode();
      // Some integrations supply only text/html, unlike an ordinary OS clipboard.
      await page.evaluate(html => { const data = new DataTransfer(); data.setData('text/html', html); document.querySelector('#visualEditor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, html);
      assert.equal(await page.locator('#code').textContent(), expected); assert.doesNotMatch(await current(), /BAD_SCRIPT|<script/);
      await undo(); assert.equal(await current(), original);
    }
  });
  await t.test('empty HTML payload and cross-code selections do not remove existing content or history', async () => {
    await wholeCode(); const before = await current();
    await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/html', '<script>bad()</script>'); document.querySelector('#visualEditor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
    assert.equal(await current(), before); assert.match(await page.locator('#status').textContent(), /没有可粘贴/);
    await page.evaluate(() => { const a = document.querySelector('#code'), b = document.querySelector('#second'), range = document.createRange(); range.setStart(a.firstChild, 0); range.setEnd(b.firstChild, 3); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    await paste('跨块覆盖'); assert.equal(await current(), before);
    assert.equal(await page.locator('#second').textContent(), 'SECOND');
  });
  await t.test('plain text works in paragraphs, lists and cells and each paste is one undo step', async () => {
    for (const selector of ['#p', '#item', '[data-dita-source="table"] td']) {
      const text = await page.locator(selector).textContent(); await select(selector, 0, text.length);
      await paste('新内容 & <OK> 中文 😀'); assert.equal(await page.locator(selector).textContent(), '新内容 & <OK> 中文 😀');
      await undo(); assert.equal(await current(), original);
    }
  });
  await t.test('tracked multi-line code paste round-trips through save, reload, review and history', async () => {
    await page.click('#trackingButton'); await page.check('#trackingEnabled'); await page.fill('#trackingAuthor', 'Clipboard QA'); await page.click('#trackingForm button[type=submit]');
    const baseline = await current(); await wholeCode(); await paste('AT+NEW\n\tWAIT=60\n\n中文 😀 & <OK>\n');
    const revision = await current();
    assert.equal(tracking.resolveForReview(revision, false), baseline);
    assert.ok(tracking.resolveForReview(revision, true).includes('AT+NEW\n\tWAIT=60\n\n中文 😀 &amp; &lt;OK&gt;\n'));
    await undo(); assert.equal(await current(), baseline); await page.click('#authorRedoButton'); assert.equal(await current(), revision);
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('paste.dita').dirty);
    assert.equal(await fs.readFile(path.join(repo, 'paste.dita'), 'utf8'), revision);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await page.evaluate(() => window.DitaApp.openFile('paste.dita'));
    assert.equal(await current(), revision); await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen');
    assert.ok(await page.locator('#code .oxy-delete').count()); assert.ok(await page.locator('#code .oxy-insert').count());
    await page.click('#rejectAllButton'); assert.equal(await current(), baseline);
  });
  assert.deepEqual(errors, []);
});
