'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core');

test('reliable writing commands, clipboard, templates and body navigation', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-writing-reliability-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const source = '<?xml version="1.0" encoding="UTF-8"?>\r\n<!--keep--><topic id="a"><title>MQTT 功能</title><body><p id="text" product="M100">前置 TCP<b>协议</b> 中文 &amp; 保留<fn product="M100">型号差异</fn></p><p id="tail">后续段落</p><table id="params"><title>参数表</title><tgroup cols="2"><colspec colname="left" colnum="1" colwidth="1*"/><colspec colname="right" colnum="2" colwidth="2*"/><tbody><row id="r"><entry id="c" colname="left">参数</entry><entry colname="right">说明</entry></row><row><entry>MQTT</entry><entry>1883</entry></row></tbody></tgroup></table><table id="merged"><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry namest="c1" nameend="c2">合并</entry></row></tbody></tgroup></table></body></topic>\r\n<?tail keep?>';
  const second = '<topic id="b"><title>HTTP 功能</title><body><p id="second">另一章节 保持不变</p></body></topic>', map = '<map><title>功能手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>';
  await fs.writeFile(path.join(repo, 'a.dita'), source); await fs.writeFile(path.join(repo, 'b.dita'), second); await fs.writeFile(path.join(repo, 'main.ditamap'), map);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' }); git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }), page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const current = () => page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current);
  const open = async name => { await page.evaluate(name => window.DitaApp.openFile(name), name); await page.waitForFunction(name => window.DitaApp.state.activePath === name && (name !== 'main.ditamap' || document.querySelectorAll('.map-topic-surface').length === 2), name); };
  const reset = async () => { await page.evaluate(source => { const a = window.DitaApp; a.setFileContent(a.state.filesMap.get('a.dita'), source); }, source); };
  const undo = async () => page.click('#authorUndoButton');
  const select = async (selector, from = 0, length = 0) => {
    await page.locator(selector).click(); await page.evaluate(({ selector, from, length }) => {
      const block = document.querySelector(selector), point = offset => { const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; } throw Error('range'); };
      const range = document.createRange(); range.setStart(...point(from)); range.setEnd(...point(from + length)); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
    }, { selector, from, length });
  };
  const paste = async (html, text) => { await page.evaluate(async ({ html, text }) => { const data = { 'text/plain': new Blob([text], { type: 'text/plain' }) }; if (html) data['text/html'] = new Blob([html], { type: 'text/html' }); await navigator.clipboard.write([new ClipboardItem(data)]); }, { html, text }); await page.keyboard.press('Control+v'); };
  await open('main.ditamap');
  await t.test('Map property edits reach the right buffer, undo/redo and filesystem save', async () => {
    await page.locator('#text').click(); await page.click('#propertiesTab'); const input = page.locator('input[data-attribute="product"]'); await input.fill('M200'); await input.press('Tab');
    assert.match(await current(), /id="text" product="M200"/); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
    await undo(); assert.equal(await current(), source); await page.click('#authorRedoButton'); assert.match(await current(), /product="M200"/);
    await page.click('#saveButton'); await page.waitForSelector('#saveScopeDialog[open]'); await page.click('#saveScopeForm button[type=submit]');
    await page.waitForFunction(() => !window.DitaApp.saving); assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), await current()); await reset();
  });
  await t.test('cell source attributes and new attributes use exact XML nodes; bad or stale edits are refused', async () => {
    await page.locator('#params td').first().click(); assert.equal(await page.inputValue('input[data-attribute="colname"]'), 'left');
    await page.fill('input[data-attribute="id"]', 'renamed-cell'); await page.locator('input[data-attribute="id"]').press('Tab'); assert.match(await current(), /entry id="renamed-cell" colname="left"/); await undo();
    await page.locator('#text').click(); await page.fill('[aria-label="新属性名"]', 'outputclass'); await page.fill('[aria-label="新属性值"]', 'a & b'); await page.click('.attribute-add-form button'); assert.match(await current(), /outputclass="a &amp; b"/); await undo();
    await page.locator('#text').click(); await page.fill('[aria-label="新属性名"]', 'invalid name'); await page.click('.attribute-add-form button'); assert.equal(await current(), source);
    await page.evaluate(() => { const a = window.DitaApp; window.staleTarget = a.authorCommands.capture(document.querySelector('#text')); });
    await page.locator('#tail').click(); await page.keyboard.press('End'); await page.keyboard.insertText('更新'); const newer = await current();
    assert.equal(await page.evaluate(() => { try { window.DitaApp.authorCommands.attribute(window.staleTarget, 'product', 'BAD'); return false; } catch { return true; } }), true); assert.equal(await current(), newer); await reset();
  });
  await t.test('delete table removes the complete table and preserves other XML exactly', async () => {
    await page.locator('#params td').first().click(); await page.click('#contextToolbar [data-context-action="delete"]');
    assert.doesNotMatch(await current(), /id="params"|参数表/); assert.match(await current(), /id="merged"/); assert.ok((await current()).startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n<!--keep-->')); assert.ok((await current()).endsWith('\r\n<?tail keep?>'));
    await undo(); assert.equal(await current(), source);
  });
  await t.test('named CALS columns, rows, headers and widths stay consistent through history', async () => {
    await page.locator('#params td').first().click(); await page.click('[data-context-action="col-after"]');
    assert.match(await current(), /tgroup cols="3"/); assert.equal(await page.locator('#params tr').first().locator('td').count(), 3); await undo();
    await page.locator('#params td').last().click(); await page.click('[data-context-action="col-delete"]'); assert.match(await current(), /tgroup cols="1"/); assert.doesNotMatch(await current(), /colname="right"/); await undo();
    await page.locator('#params td').first().click(); await page.click('[data-context-action="row-after"]'); assert.equal(await page.locator('#params tr').count(), 3); assert.equal((await current()).match(/id="r"/g).length, 1); await undo();
    await page.locator('#params td').first().click(); await page.click('[data-context-action="header"]'); assert.equal(await page.locator('#params th').count(), 2); await undo();
    await page.locator('#params td').first().click(); await page.fill('[aria-label="当前列宽"]', '3*'); await page.locator('[aria-label="当前列宽"]').press('Tab'); assert.match(await current(), /colwidth="3\*"/); await undo(); assert.equal(await current(), source);
    await page.locator('#merged td').click(); assert.equal(await page.locator('[data-context-action="col-after"]').isDisabled(), true); assert.equal(await page.locator('#merged td').getAttribute('colspan'), '2');
  });
  await t.test('native rich clipboard converts formatting and table to DITA, one-step undo and continued writing', async () => {
    await select('#tail', 2); await paste('<p><strong>外部标题</strong></p><table><tr><th>命令</th><th>说明</th></tr><tr><td>AT+OPEN</td><td><em>连接</em></td></tr></table>', '外部标题\n命令\t说明\nAT+OPEN\t连接');
    const xml = await current(); assert.match(xml, /<b>外部标题<\/b>/); assert.match(xml, /<thead><row><entry>命令<\/entry>/); assert.match(xml, /<entry><i>连接<\/i><\/entry>/); assert.doesNotMatch(xml, /<(strong|tr|td|th|em)\b/);
    await undo(); assert.equal(await current(), source); await page.click('#authorRedoButton'); await page.keyboard.insertText('继续编写'); assert.match(await current(), /继续编写/); await reset();
  });
  await t.test('clipboard strips active/foreign metadata and reports complex table fallback without corrupting source', async () => {
    await select('#tail', 1); await paste('<p id="text" onclick="alert(1)"><a href="javascript:alert(1)">安全文字</a><img src="https://example.invalid/x" onerror="alert(1)" alt="图片说明"/><span style="color:red">纯净内容</span></p>', '安全文字图片说明纯净内容');
    assert.match(await current(), /安全文字/); assert.doesNotMatch(await current(), /javascript:|onclick|onerror|<img|style=/); assert.equal((await current()).match(/id="text"/g).length, 1); await undo();
    await select('#tail', 1); await paste('<table><tr><td colspan="2">复杂表格</td></tr></table>', '复杂表格'); assert.match(await current(), /复杂表格/); assert.match(await page.locator('#toast').innerText(), /纯文本/); await undo(); assert.equal(await current(), source);
    await select('#tail', 1, 2); await paste('', '新文本 & 内容'); assert.match(await current(), /新文本 &amp; 内容/); await undo(); assert.equal(await current(), source);
  });
  await t.test('paste retains paragraph applicability and refuses protected or cross-block selections', async () => {
    await select('#text', 1); await paste('<p>新增段落</p><p>另一段落</p>', '新增段落\n另一段落');
    const xml = await current(); assert.match(xml, /<p product="M100">新增段落<\/p>/); assert.match(xml, /<p product="M100">另一段落<\/p>/); await undo(); assert.equal(await current(), source);
    await select('#text', 0, await page.locator('#text').evaluate(node => node.textContent.length)); await paste('', '禁止覆盖注脚'); assert.equal(await current(), source); assert.match(await page.locator('#status').innerText(), /注脚/);
    await page.evaluate(() => { const range = document.createRange(); range.setStart(document.querySelector('#text').firstChild, 0); range.setEnd(document.querySelector('#tail').firstChild, 2); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await paste('', '跨段落'); assert.equal(await current(), source); assert.match(await page.locator('#status').innerText(), /同一个/);
  });
  await t.test('search and note location retain Map surfaces, highlights and a return position', async () => {
    await select('#second', 2); await page.evaluate(() => { window.originalSurface = document.querySelector('.map-topic-surface[data-map-topic-path="b.dita"]'); });
    await page.click('[data-view=search]'); await page.fill('#contentSearchInput', 'TCP协议'); await page.click('#contentSearchButton'); await page.locator('.content-search-result').first().click();
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap'); assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'visual'); assert.equal(await page.evaluate(() => window.originalSurface.isConnected), true);
    await page.click('#returnWritingPosition'); assert.equal(await page.evaluate(() => getSelection().anchorNode.parentElement.closest('.map-topic-surface').dataset.mapTopicPath), 'b.dita');
    await page.click('#footnotesButton'); await page.locator('.footnote-actions button').filter({ hasText: '定位正文' }).first().click(); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap'); assert.equal(await page.evaluate(() => window.originalSurface.isConnected), true);
    await page.click('#propertiesTab');
  });
  await t.test('new document form creates business templates, rejects existing paths and retains Chinese titles', async () => {
    await page.click('#newDocumentButton'); await page.selectOption('#newDocumentTemplate', 'command'); await page.fill('#newDocumentTitle', 'MQTT 连接命令'); await page.fill('#newDocumentPath', 'b.dita'); await page.click('#newDocumentSubmit'); await page.waitForFunction(() => document.getElementById('newDocumentError').textContent.includes('已存在')); assert.match(await page.locator('#newDocumentError').innerText(), /已存在/); assert.equal(await current(), source);
    await page.fill('#newDocumentPath', '../escape.dita'); await page.click('#newDocumentSubmit'); assert.match(await page.locator('#newDocumentError').innerText(), /相对/);
    await page.fill('#newDocumentPath', 'mqtt-command.dita'); await page.click('#newDocumentSubmit'); await page.waitForFunction(() => window.DitaApp.state.activePath === 'mqtt-command.dita');
    const xml = await fs.readFile(path.join(repo, 'mqtt-command.dita'), 'utf8'); assert.match(xml, /<reference/); assert.match(xml, /MQTT 连接命令/); assert.match(xml, /<thead>/); assert.equal(await page.evaluate(() => window.DitaApp.state.mode), 'visual');
    await page.setViewportSize({ width: 390, height: 844 }); await page.click('#newDocumentButton'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.click('#newDocumentCancel'); await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await t.test('representative long Topic timing is measured and source edits retain all paragraphs', async () => {
    const result = await page.evaluate(() => {
      const core = window.DitaVisualCore, source = '<topic><title>长手册样例</title><body>' + Array.from({ length: 400 }, (_, i) => '<p id="p' + i + '">参数说明 ' + i + ' MQTT TCP HTTP 中文内容与默认值。</p>').join('') + '</body></topic>';
      const start = performance.now(), surface = core.createAuthorTopic(source), rendered = performance.now() - start, times = []; let current = source;
      for (let i = 0; i < 12; i++) { surface.querySelector('#p200').firstChild.data += '字'; const begin = performance.now(); current = core.updateCurrentFromVisual(null, { visualEditor: surface }, current); times.push(performance.now() - begin); }
      return { paragraphs: surface.querySelectorAll('p').length, rendered, editMedian: times.sort((a, b) => a - b)[6], hasLast: current.includes('id="p399"') };
    });
    assert.equal(result.paragraphs, 400); assert.equal(result.hasLast, true); t.diagnostic('Long Topic sample (ms): ' + JSON.stringify(result));
  });
  assert.deepEqual(errors, []);
});
