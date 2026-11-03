'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core'), iconv = require('iconv-lite');
const { collectDemoFiles } = require('../scripts/demo-workspace');
const { readTitle, replaceTitle } = require('../public/map-source');

test('Map title writing preserves real HTTP sources, chapter surfaces and shared history', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-map-author-')), repo = path.join(temporary, 'docs');
  const manual = 'http_httpsusermanual.ditamap';
  const corpus = collectDemoFiles(path.join(__dirname, '../examples/http_httpsusermanual'), manual);
  for (const [name, bytes] of corpus) {
    await fs.mkdir(path.dirname(path.join(repo, name)), { recursive: true });
    await fs.writeFile(path.join(repo, name), bytes);
  }
  const book = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep-->\r\n<bookmap id="book"><booktitle><booklibrary>模组库</booklibrary><mainbooktitle>HTTP 手册</mainbooktitle><booktitlealt>副标题</booktitlealt></booktitle><chapter href="small.dita"/></bookmap>\r\n<?tail keep?>';
  await fs.writeFile(path.join(repo, 'book.ditamap'), iconv.encode(book, 'gbk'));
  await fs.writeFile(path.join(repo, 'small.dita'), '<topic><title>小节</title><body><p>正文不变</p></body></topic>');
  const protectedMap = '<map><title>HTTP <b>重要</b><?oxy_comment_start author="研发"?>说明<?oxy_comment_end?></title><topicref href="small.dita"/></map>';
  await fs.writeFile(path.join(repo, 'protected.ditamap'), protectedMap);
  const legacy = '<map title = \'Legacy &amp; HTTP\'><topicref href="small.dita"/></map>';
  await fs.writeFile(path.join(repo, 'legacy.ditamap'), legacy);
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temporary, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const open = async name => {
    await page.evaluate(name => window.DitaApp.openFile(name), name);
    await page.waitForFunction(name => window.DitaApp.state.activePath === name && document.querySelector('[data-map-title]')?.ditaSourceContent === window.DitaApp.state.filesMap.get(name).current, name);
  };
  const current = name => page.evaluate(name => window.DitaApp.state.filesMap.get(name).current, name);
  const save = async name => {
    await page.click('#saveButton'); await page.waitForSelector('#saveScopeDialog[open]');
    await page.click('#saveScopeForm button[type=submit]');
    await page.waitForFunction(name => !window.DitaApp.saving && !window.DitaApp.state.filesMap.get(name).dirty, name);
  };

  await t.test('real HTTP title supports continuous input, grouped undo and redo without remounting chapters', async () => {
    await open(manual);
    const original = await current(manual), title = readTitle(original).text;
    assert.equal(await page.locator('.map-topic-surface').count(), 25);
    await page.evaluate(() => { window.retainedTitle = document.querySelector('[data-map-title]'); window.retainedChapter = document.querySelector('.map-topic-surface'); });
    await page.locator('[data-map-title]').click(); await page.keyboard.press('End');
    await page.locator('[data-map-title]').pressSequentially(' TEST', { delay: 30 });
    assert.equal(await current(manual), replaceTitle(original, title + ' TEST'));
    assert.equal(await page.evaluate(name => window.DitaApp.state.filesMap.get(name).history.undo.length, manual), 1);
    assert.equal(await page.evaluate(() => window.retainedTitle.isConnected && window.retainedChapter.isConnected && document.activeElement === window.retainedTitle), true);
    await page.click('#authorUndoButton'); assert.equal(await current(manual), original);
    await page.click('#authorRedoButton'); assert.equal(await current(manual), replaceTitle(original, title + ' TEST'));
    assert.equal(await page.evaluate(() => window.retainedTitle.isConnected && window.retainedChapter.isConnected), true);
    await save(manual);
    const encoding = corpus.get(manual).toString('ascii', 0, 200).match(/encoding\s*=\s*["']([^"']+)/i)?.[1] || 'utf8';
    assert.deepEqual(await fs.readFile(path.join(repo, manual)), iconv.encode(await current(manual), encoding));
    // Reopen from disk, and keep every other real corpus file byte-for-byte.
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await open(manual);
    assert.equal(await page.locator('[data-map-title]').textContent(), title + ' TEST');
    for (const [name, bytes] of corpus) if (name !== manual) assert.deepEqual(await fs.readFile(path.join(repo, name)), bytes);
  });

  await t.test('Bookmap title edits preserve GBK, CRLF, library/subtitle and trailing processing instructions', async () => {
    await open('book.ditamap'); await page.locator('[data-map-title]').fill('HTTP 新手册 & HTTPS');
    const expected = book.replace('>HTTP 手册<', '>HTTP 新手册 &amp; HTTPS<');
    assert.equal(await current('book.ditamap'), expected);
    await save('book.ditamap'); assert.deepEqual(await fs.readFile(path.join(repo, 'book.ditamap')), iconv.encode(expected, 'gbk'));
    await page.click('#sourceButton'); assert.equal(await page.inputValue('#editor'), expected.replace(/\r\n/g, '\n'));
    assert.equal(await current('book.ditamap'), expected);
    await page.click('#visualButton'); await page.waitForSelector('[data-map-title]');
    assert.equal(await page.locator('[data-map-title]').textContent(), 'HTTP 新手册 & HTTPS');
  });

  await t.test('protected title markup explains Source editing and cannot be flattened by typing', async () => {
    await open('protected.ditamap');
    assert.equal(await page.locator('[data-map-title]').getAttribute('contenteditable'), 'false');
    assert.match(await page.locator('.map-author-empty').innerText(), /源码模式/);
    await page.locator('[data-map-title]').click(); await page.keyboard.type('UNWANTED');
    assert.equal(await current('protected.ditamap'), protectedMap);
    await page.click('#sourceButton'); assert.equal(await page.inputValue('#editor'), protectedMap);
  });
  await t.test('legacy Map title supports plain clipboard, empty-title recovery and one-step undo', async () => {
    await open('legacy.ditamap');
    await page.locator('[data-map-title]').fill('');
    assert.equal(await current('legacy.ditamap'), legacy.replace('Legacy &amp; HTTP', ''));
    await page.evaluate(() => navigator.clipboard.writeText('HTTP <&>'));
    await page.keyboard.press('Control+v');
    assert.equal(await current('legacy.ditamap'), legacy.replace('Legacy &amp; HTTP', 'HTTP &lt;&amp;&gt;'));
    await page.click('#authorUndoButton'); assert.equal(await current('legacy.ditamap'), legacy.replace('Legacy &amp; HTTP', ''));
    await page.click('#authorUndoButton'); assert.equal(await current('legacy.ditamap'), legacy);
    await page.locator('[data-map-title]').press('Enter'); assert.equal(await current('legacy.ditamap'), legacy);
    await page.locator('[data-map-title]').press('End'); await page.keyboard.insertText(' 新版');
    assert.equal(await current('legacy.ditamap'), legacy.replace('Legacy &amp; HTTP', 'Legacy &amp; HTTP 新版'));
  });
  await t.test('direct Author modules round-trip all real HTTP Topics and patch only their title text', async () => {
    const names = [...corpus.keys()].filter(name => /\.(dita|xml)$/i.test(name));
    const result = await page.evaluate(names => {
      const failures = [];
      for (const name of names) {
        const file = window.DitaApp.state.filesMap.get(name), input = file.current;
        const parsed = window.DitaXmlDom.parseSource(input);
        const surface = window.DitaAuthorRenderer.createAuthorTopic(input, document, false, name, parsed.document);
        if (window.DitaAuthorSource.updateSource(input, surface) !== input) failures.push(name + ': round-trip');
        const title = parsed.tree.children.find(node => node.name === 'title');
        if (title?.close) {
          const heading = surface.querySelector('h2'); heading.append(document.createTextNode(' CHECK'));
          const once = window.DitaAuthorSource.updateSource(input, surface);
          heading.append(document.createTextNode(' AGAIN'));
          const twice = window.DitaAuthorSource.updateSource(once, surface);
          if (twice !== input.slice(0, title.close.start) + ' CHECK AGAIN' + input.slice(title.close.start)) failures.push(name + ': patch');
        }
        if (file.current !== input) failures.push(name + ': live buffer changed');
      }
      return { count: names.length, failures };
    }, names);
    assert.equal(result.count, 25); assert.deepEqual(result.failures, []);
  });
  await t.test('canonical ranges preserve CRLF, CDATA, PI, entities and quoted angle brackets during Author edits', async () => {
    const result = await page.evaluate(async () => {
      const input = '<?xml version="1.0" encoding="GBK"?>\r\n<!DOCTYPE topic [<!ELEMENT topic ANY>]>\r\n<!--keep--><topic id="t"><title>🔧 &amp; HTTP</title><body><p a="a > b"><![CDATA[A < B]]></p><?revision keep?></body></topic>\r\n<?tail keep?>';
      const surface = window.DitaAuthorRenderer.createAuthorTopic(input, document);
      const before = window.DitaAuthorSource.updateSource(input, surface);
      surface.querySelector('h2').append(document.createTextNode(' 更新'));
      const after = window.DitaAuthorSource.updateSource(input, surface);
      const args = { map: { title: 'CDATA', children: [{ type: 'file', path: 'cdata.dita' }] }, files: new Map([['cdata.dita', { current: input }]]) };
      const html = await window.DitaVisualCore.exportMapToHtml(args), md = await window.DitaVisualCore.exportMapToMarkdown(args);
      return { unchanged: before === input, exact: after === input.replace('🔧 &amp; HTTP</title>', '🔧 &amp; HTTP 更新</title>'),
        visible: surface.textContent.includes('A < B'), html: html.includes('A &lt; B'), md: md.includes('A < B') };
    });
    assert.deepEqual(result, { unchanged: true, exact: true, visible: true, html: true, md: true });
  });
  assert.deepEqual(errors, []);
});
