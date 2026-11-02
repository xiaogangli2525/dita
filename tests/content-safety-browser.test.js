'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core');

test('untrusted document content stays inert in the real browser and retains authoring XML', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-content-safety-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const mark = 'window.__injected=(window.__injected||0)+1';
  const source = `<topic id="unsafe"><title onclick="${mark}">Title</title><shortdesc onmouseover="${mark}">Summary</shortdesc><body><p id="safe-paragraph" onclick="${mark}" style="position:fixed;inset:0" data-dita-source="image">Editable<xref href="java&#10;script:${mark}">Link</xref></p><image href="missing.png" src="https://example.invalid/source" srcset="https://example.invalid/source2 2x" onerror="${mark}"/><codeblock onmouseover="${mark}">CODE</codeblock></body></topic>`;
  await fs.writeFile(path.join(repo, 'a.dita'), '<topic><title>Home</title><body><p>Home</p></body></topic>');
  await fs.writeFile(path.join(repo, 'unsafe.dita'), source);
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }); let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage(), errors = [], remote = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://example.invalid/**', route => { remote.push(route.request().url()); return route.abort(); });
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);

  await t.test('imported event/style/resource attributes never become active HTML', async () => {
    await page.evaluate(() => window.DitaApp.openFile('unsafe.dita'));
    const result = await page.evaluate(() => {
      const surface = document.getElementById('visualEditor');
      for (const element of surface.querySelectorAll('*')) for (const type of ['click', 'mouseover', 'error']) element.dispatchEvent(new Event(type));
      return { injected: window.__injected || 0, active: [...surface.querySelectorAll('*')].flatMap(node => [...node.attributes].filter(a => /^on/i.test(a.name)).map(a => a.name)), sourceTag: surface.querySelector('#safe-paragraph').getAttribute('data-dita-source'), style: surface.querySelector('#safe-paragraph').getAttribute('style'), href: surface.querySelector('a').getAttribute('href'), srcset: surface.querySelector('img').getAttribute('srcset') };
    });
    assert.deepEqual(result, { injected: 0, active: [], sourceTag: 'p', style: null, href: null, srcset: null }); assert.deepEqual(remote, []);
  });

  await t.test('unchanged views and adjacent text edits preserve source-only attributes exactly', async () => {
    const result = await page.evaluate(source => {
      const core = window.DitaApp.ditaCore, surface = document.getElementById('visualEditor');
      const unchanged = core.updateCurrentFromVisual(null, { visualEditor: surface }, source);
      surface.querySelector('#safe-paragraph').firstChild.data = 'Edited';
      return { unchanged, edited: core.updateCurrentFromVisual(null, { visualEditor: surface }, source) };
    }, source);
    assert.equal(result.unchanged, source); assert.equal(result.edited, source.replace('Editable', 'Edited'));
    assert.equal(await fs.readFile(path.join(repo, 'unsafe.dita'), 'utf8'), source);
  });

  await t.test('Markdown URLs, labels and code language names cannot inject attributes or executable links', async () => {
    const result = await page.evaluate(() => {
      const node = document.createElement('div');
      node.innerHTML = window.DitaApp.ditaCore.renderMarkdownToHtml('[bad](javascript:window.__injected=1) ![picture](https://example.invalid/"onerror="window.__injected=1)\n```x"onclick="window.__injected=1\ntext\n```');
      document.body.append(node);
      for (const element of node.querySelectorAll('*')) for (const type of ['click', 'error']) element.dispatchEvent(new Event(type));
      const result = { injected: window.__injected || 0, events: node.querySelectorAll('[onerror],[onclick]').length, unsafeLinks: [...node.querySelectorAll('a')].filter(a => /^javascript:/i.test(a.href)).length, text: node.textContent };
      node.remove(); return result;
    });
    assert.equal(result.injected, 0); assert.equal(result.events, 0); assert.equal(result.unsafeLinks, 0); assert.match(result.text, /bad/);
  });
  assert.deepEqual(errors, []);
});
