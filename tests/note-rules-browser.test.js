'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

test('external footnote rules are reviewed independently and applied only to captured delivery', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-note-rules-')), repo = path.join(temp, 'docs');
  await fs.mkdir(repo);
  const source = '<?xml version="1.0" encoding="UTF-8"?>\r\n<topic id="t"><title>功能手册</title><body><p id="command">Command<fn>通用说明。<div>M100：支持<b>参数一</b>。M300：支持<i>参数二</i>。</div></fn></p><p>Other<fn>尚未确认的说明。</fn></p></body></topic>';
  const other = '<topic id="other"><title>MQTT</title><body><p>Command<fn>BX-7：另一手册说明。</fn></p></body></topic>';
  for (const [name, content] of Object.entries({
    'a.dita': source, 'other.dita': other,
    'main.ditamap': '<map><title>HTTP</title><topicref href="a.dita"/></map>',
    'other.ditamap': '<map><title>MQTT</title><topicref href="other.dita"/></map>',
    '.dita-project.json': JSON.stringify({ schema: 1, models: ['M100', 'M300', 'BX-7'] })
  })) await fs.writeFile(path.join(repo, name), content);
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const open = async file => { await page.evaluate(file => window.DitaApp.openFile(file), file); await page.waitForFunction(file => window.DitaApp.state.activePath === file, file); };
  const delivery = async () => { await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor(); };
  const rulePath = path.join(repo, '.dita-note-rules.json');
  let saved;
  await open('main.ditamap');

  await t.test('pending suggestions cannot save and confirmed fragments preserve the original', async () => {
    await page.click('#footnotesButton'); await page.click('#noteRulesButton'); await page.locator('.note-rule-part').first().waitFor();
    assert.equal(await page.locator('.note-rule-part').count(), 3);
    assert.equal(await page.locator('#noteRuleList [aria-current=true]').count(), 1);
    await page.click('#noteRuleSave'); await page.waitForFunction(() => document.getElementById('noteRulesError').textContent.includes('确认'));
    await assert.rejects(fs.stat(rulePath), { code: 'ENOENT' });
    await page.selectOption('[aria-label="片段 1 适用范围"]', 'common'); await page.click('#noteRuleSuggestions');
    await page.selectOption('#noteRulePreviewModel', 'M100');
    const preview = await page.locator('#noteRulePreview').innerText();
    assert.match(preview, /通用说明/); assert.match(preview, /参数一/); assert.doesNotMatch(preview, /参数二/);
    if (process.env.DITA_QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.DITA_QA_SCREENSHOTS, 'note-rules-wide.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator('#noteRulesDialog').evaluate(node => ({ width: node.getBoundingClientRect().width, content: node.scrollWidth, inner: node.clientWidth }));
    assert.ok(bounds.width <= 390 && bounds.content <= bounds.inner + 1, JSON.stringify(bounds));
    assert.ok(await page.locator('#noteRulesDialog').evaluate(() => document.getElementById('noteRuleList').getBoundingClientRect().bottom <= document.getElementById('noteRuleSource').getBoundingClientRect().top));
    await page.locator('#noteRuleSave').evaluate(node => { const r = node.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) throw Error('Save must remain visible without scrolling all fragments'); });
    if (process.env.DITA_QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.DITA_QA_SCREENSHOTS, 'note-rules-compact.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.click('#noteRuleSave'); await page.waitForFunction(() => document.getElementById('noteRuleStatus').textContent.includes('已确认保存'));
    saved = await fs.readFile(rulePath, 'utf8'); assert.equal(JSON.parse(saved).rules.length, 1);
    assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), source);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), source);
    await page.click('#noteRulesClose');
  });

  for (const [model, keep, omit] of [['M100', '参数一', '参数二'], ['M300', '参数二', '参数一']]) await t.test(model + ' HTML and Markdown use the same confirmed rules', async () => {
    for (const format of ['html', 'md']) {
      await delivery(); await page.selectOption('#exportModel', model); await page.selectOption('#exportFormat', format);
      const waiting = page.waitForEvent('download'); await page.click('#modelExportForm [value=download]');
      const download = await waiting, output = await fs.readFile(await download.path(), 'utf8');
      assert.match(output, /通用说明/); assert.match(output, new RegExp(keep)); assert.doesNotMatch(output, new RegExp(omit)); assert.match(output, /尚未确认的说明/);
      assert.ok(await page.evaluate(() => window.DitaApp.lastDeliveryRecord.noteRulesSha256));
      assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), source);
    }
  });

  await t.test('external changes invalidate checked output and reject an overlapping save without discarding choices', async () => {
    await delivery(); await page.selectOption('#exportModel', 'M100'); await page.click('#modelExportForm [value=check]');
    await page.waitForFunction(() => document.getElementById('deliveryCheckStatus').textContent.includes('检查通过'));
    await fs.writeFile(rulePath, saved + '\n'); let downloaded = false;
    const onDownload = () => { downloaded = true; }; page.on('download', onDownload);
    await page.click('#modelExportForm [value=download]');
    await page.waitForFunction(() => document.getElementById('modelExportError').textContent.includes('规则已变化'));
    assert.equal(downloaded, false); page.off('download', onDownload);
    await page.click('#modelExportCancel'); await fs.writeFile(rulePath, saved);
    await page.click('#noteRulesButton'); await page.locator('.note-rule-part').first().waitFor();
    await fs.writeFile(rulePath, saved + '\n'); await page.click('#noteRuleSaveNext');
    await page.waitForFunction(() => document.getElementById('noteRulesError').textContent.includes('变化'));
    assert.equal(await page.inputValue('[aria-label="片段 1 适用范围"]'), 'common');
    assert.equal(await fs.readFile(rulePath, 'utf8'), saved + '\n');
    await page.click('#noteRulesClose'); await fs.writeFile(rulePath, saved);
  });

  await t.test('rule filters preserve drafts and save-next advances only after confirmation is persisted', async () => {
    await page.click('#noteRulesButton'); await page.locator('.note-rule-part').first().waitFor();
    assert.match(await page.locator('#noteRulesCount').innerText(), /已确认 1\/2/);
    await page.selectOption('#noteRuleFilter', 'expired');
    assert.equal(await page.locator('#noteRuleSaveNext').isDisabled(), true);
    await page.selectOption('#noteRuleFilter', 'confirmed');
    assert.equal(await page.locator('#noteRuleList button').count(), 1);
    await page.click('#noteRuleDelete'); await page.waitForFunction(() => document.getElementById('noteRulesCount').textContent.includes('已确认 0/2'));
    await page.selectOption('#noteRuleFilter', 'pending');
    assert.equal(await page.locator('#noteRuleList button').count(), 2);
    await page.selectOption('[aria-label="片段 1 适用范围"]', 'common');
    await page.selectOption('#noteRuleFilter', 'confirmed');
    await page.selectOption('#noteRuleFilter', 'pending');
    assert.equal(await page.inputValue('[aria-label="片段 1 适用范围"]'), 'common');
    await page.click('#noteRuleSuggestions'); await page.click('#noteRuleSaveNext');
    await page.waitForFunction(() => document.getElementById('noteRuleStatus').textContent.includes('正在核对下一条'));
    assert.match(await page.locator('#noteRulesCount').innerText(), /已确认 1\/2/);
    assert.equal(await page.locator('#noteRuleOriginal').textContent(), '尚未确认的说明。');
    await page.click('#noteRuleCommon'); await page.click('#noteRuleSaveNext');
    await page.waitForFunction(() => document.getElementById('noteRuleStatus').textContent.includes('全部确认'));
    assert.match(await page.locator('#noteRulesCount').innerText(), /已确认 2\/2/);
    assert.equal(await page.locator('#noteRuleList button').count(), 0);
    await page.selectOption('#noteRuleFilter', 'confirmed');
    assert.equal(await page.locator('#noteRuleList button').count(), 2);
    assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), source);
    await page.click('#noteRulesClose'); await fs.writeFile(rulePath, saved);
  });

  await t.test('a queued close event cannot cancel a newly opened note-rule dialog', async () => {
    await page.evaluate(() => {
      document.getElementById('noteRulesButton').click();
      // Native close events are queued; a previous close can arrive after reopen.
      document.getElementById('noteRulesDialog').dispatchEvent(new Event('close'));
    });
    await page.locator('.note-rule-part').first().waitFor();
    assert.equal(await page.locator('.note-rule-part').count(), 3);
    await page.click('#noteRulesClose');
  });

  await t.test('a different manual requires fresh confirmation and discovers its own model', async () => {
    await open('other.ditamap'); await page.click('#noteRulesButton'); await page.locator('.note-rule-part').first().waitFor();
    assert.equal(await page.locator('.note-rule-part').count(), 1);
    await page.locator('#noteRulesDialog summary').click(); assert.match(await page.locator('#noteRuleOriginal').innerText(), /BX-7/);
    assert.equal(await page.inputValue('[aria-label="片段 1 适用型号"]'), 'BX-7');
    assert.equal(await page.inputValue('[aria-label="片段 1 适用范围"]'), 'pending');
    await page.click('#noteRulesClose');
  });

  await t.test('an edited source blocks outdated rules while disk DITA stays intact', async () => {
    await open('main.ditamap');
    await page.evaluate(() => { const a = window.DitaApp; a.setFileContent(a.state.filesMap.get('a.dita'), a.state.filesMap.get('a.dita').current.replace('参数一', '参数已变')); });
    await delivery(); await page.selectOption('#exportModel', 'M100');
    await page.waitForFunction(() => document.getElementById('modelExportError').textContent.includes('规则已过期'));
    await page.click('#modelExportCancel'); assert.equal(await fs.readFile(path.join(repo, 'a.dita'), 'utf8'), source);
  });
  assert.deepEqual(errors, []);
});
