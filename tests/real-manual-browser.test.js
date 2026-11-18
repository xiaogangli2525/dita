'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { chromium } = require('playwright-core'), { unzipSync, strFromU8 } = require('fflate');
const { collectDemoFiles } = require('../scripts/demo-workspace');
const templates = require('../public/template-core');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compact = text => text.replace(/\s+/g, '');

test('real HTTP manual survives visual editing, review, save and two-model delivery with explicit format limits', async t => {
  const sourceRoot = path.join(__dirname, '../examples/http_httpsusermanual'), mapPath = 'http_httpsusermanual.ditamap';
  const originals = collectDemoFiles(sourceRoot, mapPath), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-real-manual-')), repo = path.join(temp, 'docs');
  const output = process.env.DITA_MANUAL_QA_DIR;
  if (output) await fs.mkdir(output, { recursive: true });
  for (const [name, bytes] of originals) { await fs.mkdir(path.dirname(path.join(repo, name)), { recursive: true }); await fs.writeFile(path.join(repo, name), bytes); }
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Real manual acceptance copy']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port), DITA_TEMPLATE_DIR: path.join(temp, 'templates'), DITA_AI_CONFIG_FILE: path.join(temp, 'ai.json'), DITA_AI_BASE_URL: '', DITA_AI_API_KEY: '', DITA_AI_MODEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }), errors = [], deliveries = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  const open = file => page.evaluate(file => window.DitaApp.openFile(file), file);
  const editedPath = 'topics/r_https_example.dita', original = originals.get(editedPath).toString('utf8');
  const expected = original.replace('SSL相应参数设置', 'SSL相关参数设置');
  assert.notEqual(expected, original);
  async function stage(name, action) {
    let passed = false;
    await t.test(name, async () => { await action(); passed = true; });
    assert.ok(passed, 'Stop dependent acceptance steps after: ' + name);
  }
  await stage('editing keeps native DITA and commands intact; review marks disappear only after acceptance and disk changes only on save', async () => {
    await open(editedPath);
    const note = page.locator('#visualEditor [data-dita-source="note"]').filter({ hasText: 'SSL相应参数设置' }); await note.waitFor();
    await note.click();
    await note.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) if (node.data.includes('相应参数')) break;
      if (!node) throw Error('Expected source text not rendered');
      const start = node.data.indexOf('相应参数'), range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 2);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
    });
    await page.keyboard.insertText('相关');
    await page.waitForFunction(({ editedPath, expected }) => window.DitaApp.state.filesMap.get(editedPath).current === expected, { editedPath, expected });
    assert.equal(await fs.readFile(path.join(repo, editedPath), 'utf8'), original);
    await page.click('#reviewButton');
    const removed = page.locator('#visualEditor [data-review-text="old"]'), added = page.locator('#visualEditor [data-review-text="new"]');
    assert.equal(await removed.textContent(), '应'); assert.equal(await added.textContent(), '关');
    assert.match(await removed.evaluate(node => getComputedStyle(node).textDecorationLine), /line-through/);
    assert.notEqual(await removed.evaluate(node => getComputedStyle(node).backgroundColor), await added.evaluate(node => getComputedStyle(node).backgroundColor));
    await page.locator('#diff').getByRole('button', { name: '接受此块', exact: true }).click();
    assert.equal(await page.locator('#visualEditor [data-review-text]').count(), 0);
    assert.equal(await fs.readFile(path.join(repo, editedPath), 'utf8'), original);
    await page.click('#saveButton'); await page.waitForFunction(editedPath => !window.DitaApp.state.filesMap.get(editedPath).dirty, editedPath);
    assert.equal(await fs.readFile(path.join(repo, editedPath), 'utf8'), expected);
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root); await open(editedPath);
    assert.match(await page.locator('#visualEditor').innerText(), /SSL相关参数设置/);
  });
  const sourcePackage = process.env.DITA_MANUAL_TEMPLATE_FILE ? JSON.parse(await fs.readFile(process.env.DITA_MANUAL_TEMPLATE_FILE, 'utf8')) : templates.builtins().find(pack => pack.id === 'enterprise-blue' && pack.version === '1.2.0');
  const pack = templates.normalizePackage({ ...sourcePackage, id: 'acceptance-enterprise', version: '1.0.0', formats: ['pdf', 'docx'] });
  const imported = await page.evaluate(async pack => { const response = await window.DitaApp.api.request('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pack) }); if (!response.ok) throw Error(await window.DitaApp.api.error(response)); return response.json(); }, pack);
  assert.equal(imported.sha256, hash(JSON.stringify(pack)));
  await open(mapPath);
  for (const model of ['ML307G', 'ML307N']) {
    let expectedNotes = [], expectedCommands = [];
    for (const format of ['html', 'md', 'pdf', 'docx']) await stage(model + ' ' + format + (format === 'md' ? ' explicitly blocks merged tables without recording a delivery' : ' contains the saved edit and filtered notes with matching provenance'), async () => {
      await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
      await page.selectOption('#exportFilter', 'filters/filter_tbd.ditaval'); await page.locator('#exportModel:not(:disabled)').waitFor();
      await page.selectOption('#exportModel', model); await page.check('#exportPrefixNotes'); await page.selectOption('#exportFormat', format);
      await page.fill('#exportVersion', 'V6.2.1-验收');
      if (['pdf', 'docx'].includes(format)) {
        await page.selectOption('#exportTemplate', templates.key(pack));
        await page.fill('#exportTitle', 'HTTP/HTTPS用户手册'); await page.fill('#exportCompany', pack.company.name || '文档交付验收');
        await page.fill('#exportDocumentId', 'HTTP-ACCEPTANCE');
      }
      const previousDelivery = await page.evaluate(() => window.DitaApp.lastDeliveryRecord?.outputSha256);
      await page.click('#modelExportForm [value=check]');
      await page.waitForFunction(() => !document.querySelector('[data-delivery-step=export]').disabled || document.getElementById('modelExportError').textContent.trim(), null, { timeout: 60000 });
      const error = await page.locator('#modelExportError').innerText();
      if (format === 'md') {
        assert.match(await page.locator('#exportFormatHint').innerText(), /合并单元格.*HTML、Word 或 PDF/);
        assert.match(error, /合并单元格/); assert.equal(await page.evaluate(() => window.DitaApp.lastDeliveryRecord?.outputSha256), previousDelivery);
        assert.equal(await page.locator('[data-delivery-step=export]').isDisabled(), true);
        deliveries.push({ model, format, status: 'blocked', reason: error });
        await page.click('#modelExportCancel'); return;
      }
      assert.equal(error, '');
      const pending = page.waitForEvent('download', { timeout: 60000 }); await page.click('#modelExportForm [value=download]');
      const download = await pending, bytes = await fs.readFile(await download.path()), filename = download.suggestedFilename();
      if (output) await fs.writeFile(path.join(output, filename), bytes);
      await page.waitForFunction(filename => window.DitaApp.lastDeliveryRecord?.filename === filename, filename);
      const record = await page.evaluate(() => window.DitaApp.lastDeliveryRecord);
      assert.equal(record.outputSha256, hash(bytes)); assert.equal(record.model, model); assert.equal(record.filterPath, 'filters/filter_tbd.ditaval');
      assert.equal(record.modelNotePrefixPolicy, 'explicit-prefix-v1'); assert.deepEqual(record.unsavedPaths, []);
      assert.equal(record.documents.find(doc => doc.path === editedPath).sha256, hash(expected));
      let text, notes;
      if (format === 'html') {
        const doc = await browser.newPage(); await doc.setContent(bytes.toString('utf8'));
        expectedNotes = await doc.locator('.export-footnotes > ol > li').allTextContents(); expectedNotes = expectedNotes.map(text => text.replace(/↩\s*返回正文/g, '').trim());
        assert.ok(expectedNotes.length > 0);
        text = await doc.locator('body').innerText(); notes = expectedNotes.join('\n');
        expectedCommands = [...new Set(text.match(/AT\+[A-Z][A-Z0-9_]*/g) || [])]; assert.ok(expectedCommands.length >= 10);
        await doc.close();
      } else if (format === 'md') {
        text = bytes.toString('utf8'); assert.match(text, /分包是在网络包/);
      } else if (format === 'pdf') {
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        const pdfPath = path.join(temp, model + '.pdf'); await fs.writeFile(pdfPath, bytes);
        const mm = value => value * 72 / 25.4, margins = pack.page.marginsMm, [width, height] = templates.sizes[pack.page.size];
        // Compare body text across page breaks without inserting running headers/footers into a long note.
        text = execFileSync('pdftotext', ['-layout', '-x', String(Math.floor(mm(margins.left)) - 1), '-y', String(Math.floor(mm(margins.top)) - 1), '-W', String(Math.ceil(mm(width - margins.left - margins.right)) + 2), '-H', String(Math.ceil(mm(height - margins.top - margins.bottom)) + 2), pdfPath, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        const offset = [...text.matchAll(/^\s*注脚\s*$/gm)].at(-1)?.index; assert.ok(offset != null); notes = text.slice(offset);
      } else {
        const zip = unzipSync(bytes), xml = strFromU8(zip['word/document.xml']);
        ({ text, notes } = await page.evaluate(xml => {
          const doc = new DOMParser().parseFromString(xml, 'application/xml'), children = [...doc.getElementsByTagName('w:body')[0].children];
          const text = node => [...node.getElementsByTagName('w:t')].map(item => item.textContent).join('');
          const start = children.findIndex(node => text(node) === '注脚'); if (start < 0) throw Error('Missing endnote heading');
          return { text: text(doc), notes: children.slice(start + 1).map(text).join('\n') };
        }, xml));
        assert.match(xml, /TOC .*\\h/); assert.match(xml, /PAGEREF _Toc\d+/);
      }
      assert.match(compact(text), /SSL相关参数设置/); assert.doesNotMatch(compact(text), /SSL相应参数设置/);
      for (const command of expectedCommands) assert.ok(compact(text).includes(command), 'preserves ' + command);
      if (notes) {
        const names = notes.match(/\b(?:ML|MN|MR)\d+[A-Z0-9]*(?:-[A-Z0-9]+)*\b/g) || [];
        assert.ok(names.length); assert.ok(names.every(name => name === model), names.join(','));
        for (const note of expectedNotes) assert.ok(compact(notes).includes(compact(note)), 'retains the complete filtered note: ' + note.slice(0, 90));
      }
      if (['pdf', 'docx'].includes(format)) { assert.equal(record.template.sha256, imported.sha256); assert.equal(record.template.fields['manual.model'], model); }
      deliveries.push({ model, format, filename, bytes: bytes.length, sha256: record.outputSha256, notes: expectedNotes.length, commands: expectedCommands.length, templateSha256: record.template?.sha256 || null });
    });
  }
  for (const [name, bytes] of originals) {
    assert.deepEqual(await fs.readFile(path.join(sourceRoot, name)), bytes, 'supplied manual remains unchanged: ' + name);
    assert.deepEqual(await fs.readFile(path.join(repo, name)), name === editedPath ? Buffer.from(expected) : bytes, 'only the accepted source edit is saved: ' + name);
  }
  assert.deepEqual(errors, []);
  if (output) await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ sourceMap: mapPath, sourceFiles: originals.size, topics: [...originals.keys()].filter(name => name.endsWith('.dita')).length, edit: { path: editedPath, before: 'SSL相应参数设置', after: 'SSL相关参数设置', diskBefore: hash(original), diskAfter: hash(expected) }, deliveries, realModelExecuted: false, wordWpsExecuted: false }, null, 2) + '\n');
});
