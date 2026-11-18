'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core');

test('competing page drafts remain individually recoverable through refresh, save, discard and legacy recovery', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-draft-tabs-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = '<topic><title>Draft safety</title><body><p>BASE</p></body></topic>', content = label => original.replace('BASE', label);
  await fs.writeFile(path.join(repo, 'a.dita'), original); await fs.writeFile(path.join(repo, 'legacy.dita'), original);
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, DITA_AI_CONFIG_FILE: path.join(temp, 'ai.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext(), a = await context.newPage(), b = await context.newPage(), errors = [];
  const start = async page => { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept()); await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root); await page.evaluate(() => window.DitaApp.openFile('a.dita')); };
  const backups = page => page.evaluate(() => window.DitaDraftStore.createDraftStore(localStorage).list({ root: window.DitaApp.state.root, branch: window.DitaApp.state.currentBranch }));
  const edit = async (page, text) => { await page.click('#sourceButton'); await page.fill('#editor', content(text)); await page.evaluate(() => window.DitaApp.drafts.flush()); };
  await start(a); await start(b);
  await t.test('both windows show different versions and download exactly the selected backup', async () => {
    await edit(a, 'WINDOW_A'); await edit(b, 'WINDOW_B');
    await a.waitForFunction(() => document.getElementById('draftsButton').textContent.includes('有不同版本'));
    assert.deepEqual((await backups(a)).map(draft => draft.current).sort(), [content('WINDOW_A'), content('WINDOW_B')]);
    assert.match(await b.locator('#draftsButton').innerText(), /有不同版本/);
    await a.click('#draftsButton'); assert.equal(await a.locator('#draftList article').count(), 2);
    assert.match(await a.locator('#draftList article').filter({ hasText: 'WINDOW_A' }).innerText(), /当前窗口/);
    assert.match(await a.locator('#draftList article').filter({ hasText: 'WINDOW_B' }).innerText(), /其他窗口/);
    for (const label of ['WINDOW_A', 'WINDOW_B']) {
      const waiting = a.waitForEvent('download'); await a.locator('#draftList article').filter({ hasText: label }).getByRole('button', { name: '下载草稿', exact: true }).click();
      assert.equal(await fs.readFile(await (await waiting).path(), 'utf8'), content(label));
    }
    await a.click('#draftClose');
  });
  await t.test('refresh retains both snapshots; saving a restored snapshot preserves the competing version', async () => {
    await a.reload(); await a.waitForFunction(() => window.DitaApp?.state.root); await a.evaluate(() => window.DitaApp.openFile('a.dita'));
    assert.equal((await backups(a)).length, 2);
    await a.click('#draftsButton'); await a.locator('#draftList article').filter({ hasText: 'WINDOW_A' }).getByRole('button', { name: '恢复到编辑区' }).click();
    await a.waitForFunction(() => window.DitaApp.state.filesMap.get('a.dita').current.includes('WINDOW_A'));
    assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), original);
    await a.click('#saveButton'); await a.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty); await a.evaluate(() => window.DitaApp.drafts.flush());
    assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), content('WINDOW_A'));
    assert.deepEqual((await backups(a)).map(draft => draft.current), [content('WINDOW_B')]);
    await b.click('#saveButton'); await b.waitForFunction(() => document.getElementById('status').textContent.includes('保存失败'));
    assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), content('WINDOW_A'));
    assert.deepEqual((await backups(b)).map(draft => draft.current), [content('WINDOW_B')]);
  });
  await t.test('legacy backups stay readable and explicit discard affects only the selected snapshot', async () => {
    const legacyKey = await a.evaluate(original => {
      const app = window.DitaApp, value = { schema: 1, root: app.state.root, branch: app.state.currentBranch, path: 'legacy.dita', base: original, current: original.replace('BASE', 'LEGACY'), updatedAt: 1 };
      const key = 'dita.draft.v1:' + JSON.stringify([value.root, value.branch, value.path]); localStorage.setItem(key, JSON.stringify(value)); return key;
    }, original);
    await a.click('#draftsButton'); const row = a.locator('#draftList article').filter({ hasText: 'legacy.dita' }); assert.match(await row.innerText(), /旧版草稿/);
    await row.getByRole('button', { name: '恢复到编辑区' }).click(); await a.waitForFunction(() => window.DitaApp.state.filesMap.get('legacy.dita')?.current.includes('LEGACY'));
    await a.click('#saveButton'); await a.waitForFunction(() => !window.DitaApp.state.filesMap.get('legacy.dita').dirty); await a.evaluate(() => window.DitaApp.drafts.flush());
    assert.equal(await a.evaluate(key => localStorage.getItem(key), legacyKey), null);
    assert.equal(await fs.readFile(path.join(repo, 'legacy.dita'), 'utf8'), content('LEGACY'));
    assert.deepEqual((await backups(a)).map(draft => draft.current), [content('WINDOW_B')]);
    await edit(a, 'SECOND_DRAFT'); await a.click('#draftsButton');
    await a.locator('#draftList article').filter({ hasText: 'SECOND_DRAFT' }).getByRole('button', { name: '丢弃', exact: true }).click();
    assert.deepEqual((await backups(a)).map(draft => draft.current), [content('WINDOW_B')]);
  });
  assert.deepEqual(errors, []);
});
