'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { unzipSync, strFromU8 } = require('fflate');
const { chromium } = require('playwright-core');

test('PDF and editable Word delivery', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-office-')), repo = path.join(temp, 'docs');
  await fs.cp(path.join(__dirname, 'fixtures/manual'), repo, { recursive: true });
  let publish = await fs.readFile(path.join(repo, 'topics/publish.dita'), 'utf8');
  const rows = Array.from({ length: 42 }, (_, i) => `<row><entry>AT+TEST${i}</entry><entry>参数范围 ${i} 到 ${i + 16}。模块返回 OK 后继续发送下一条命令。</entry></row>`).join('');
  publish = publish.replace('</body>', `<section><title>命令参数参考</title><table><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><thead><row><entry>命令</entry><entry>说明</entry></row></thead><tbody><row><entry namest="c1" nameend="c2">合并单元格 MERGED_CELL</entry></row><row><entry morerows="1">连接参数</entry><entry>第一项</entry></row><row><entry>第二项</entry></row>${rows}</tbody></tgroup></table></section></body>`);
  await fs.writeFile(path.join(repo, 'topics/publish.dita'), require('iconv-lite').encode(publish, 'gbk'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { if (browser) await browser.close(); if (child.exitCode == null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server did not start')), 10000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ acceptDownloads: true }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
  await page.click('[data-view="search"]'); await page.fill('#workspaceSearchInput', 'topics/connect.dita'); await page.locator('.workspace-result').filter({ hasText: 'topics/connect.dita' }).click();
  await page.waitForFunction(() => window.DitaApp.state.activePath === 'topics/connect.dita');
  await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get(a.state.activePath); a.setFileContent(f, f.current.replace('AT+MQTTOPEN', 'AT+MQTTOPEN UNSAVED_BINARY')); });
  await page.fill('#workspaceSearchInput', 'main.ditamap'); await page.locator('.workspace-result').filter({ hasText: 'main.ditamap' }).click(); await page.waitForFunction(() => window.DitaApp.state.activePath === 'main.ditamap');
  const delivery = async (format, model = 'M100') => { await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor(); await page.selectOption('#exportModel', model); await page.selectOption('#exportFormat', format); await page.fill('#exportVersion', 'V3.0'); };
  for (const format of ['docx', 'pdf']) for (const model of ['M100', 'M300']) await t.test(`${format} ${model} downloads real bytes and records their SHA256`, async () => {
    await delivery(format, model);
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('#modelExportForm [value=download]');
    const download = await downloadPromise, bytes = await fs.readFile(await download.path());
    assert.equal(download.suggestedFilename(), `main-${model}-V3-0.${format}`);
    assert.ok(bytes.length > 5000);
    if (format === 'pdf') { assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3); }
    else {
      const zip = unzipSync(bytes), xml = strFromU8(zip['word/document.xml']);
      assert.match(xml, /UNSAVED_BINARY/); assert.match(xml, /<w:tbl>/); assert.match(xml, /<w:gridSpan w:val="2"/); assert.match(xml, /<w:vMerge/);
      assert.match(xml, /中文|参数范围/); assert.match(strFromU8(zip['word/styles.xml']), /<w:keepNext\/>/); assert.match(xml, /<w:tblHeader\/>/);
      assert.match(xml, /MERGED_CELL/); assert.match(xml, /AT\+TEST41/);
      assert.ok(Object.keys(zip).some(key => /^word\/media\/.*\.png$/.test(key)), 'SVG has a PNG in Word');
      assert.equal((xml.match(/AB_SHARED/g) || []).length, model === 'M100' ? 1 : 0);
      if (model === 'M100') { assert.match(xml, /A_CONREF/); assert.match(xml, /INHERITED_AB/); assert.doesNotMatch(xml, /C_ONLY|INHERITED_B|ANCESTOR_EXCLUDED/); }
      else { assert.match(xml, /C_ONLY/); assert.doesNotMatch(xml, /A_CONREF|INHERITED_AB|INHERITED_B|ANCESTOR_EXCLUDED/); }
      assert.doesNotMatch(xml, /<w:footnoteReference/); // one shared end definition, rather than renumbered copies
    }
    await page.waitForFunction(name => window.DitaApp.lastDeliveryRecord?.filename === name, download.suggestedFilename());
    const record = await page.evaluate(() => window.DitaApp.lastDeliveryRecord);
    assert.equal(record.outputSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.ok(record.unsavedPaths.includes('topics/connect.dita'));
    if (process.env.DITA_OFFICE_QA_DIR) { await fs.mkdir(process.env.DITA_OFFICE_QA_DIR, { recursive: true }); await fs.writeFile(path.join(process.env.DITA_OFFICE_QA_DIR, download.suggestedFilename()), bytes); }
  });
  await t.test('PDF preview uses generated bytes and HTML preview restores the sandbox', async () => {
    await delivery('pdf'); await page.click('#modelExportForm [value=preview]'); await page.waitForFunction(() => !document.getElementById('modelExportDialog').open);
    assert.equal(await page.locator('#deliveryPreviewTitle').innerText(), 'PDF 预览');
    assert.equal(await page.locator('#htmlPreviewFrame').getAttribute('sandbox'), null);
    const signature = await page.evaluate(async () => (await (await fetch(document.getElementById('htmlPreviewFrame').src)).text()).slice(0, 5)); assert.equal(signature, '%PDF-');
    await page.click('#closeHtmlPreviewButton'); await delivery('html'); await page.click('#modelExportForm [value=preview]'); await page.waitForFunction(() => !document.getElementById('modelExportDialog').open);
    assert.equal(await page.locator('#htmlPreviewFrame').getAttribute('sandbox'), 'allow-same-origin'); await page.click('#closeHtmlPreviewButton');
  });
  await t.test('online PDF printing is labelled and never fabricates a download record', async () => {
    const before = await page.evaluate(() => { window.DitaApp.state.capabilities.pdf = false; return window.DitaApp.lastDeliveryRecord.filename; });
    await delivery('pdf'); assert.match(await page.locator('#exportFormatHint').innerText(), /打印不写入交付记录/);
    await page.click('#modelExportForm [value=download]'); await page.waitForFunction(() => !document.getElementById('printDeliveryButton').disabled);
    assert.match(await page.frameLocator('#htmlPreviewFrame').locator('body').innerText(), /UNSAVED_BINARY/);
    await page.evaluate(() => document.getElementById('htmlPreviewFrame').contentWindow.addEventListener('beforeprint', () => { window.printRequested = true; }));
    await page.click('#printDeliveryButton'); await page.waitForFunction(() => !!window.printRequested);
    assert.equal(await page.evaluate(() => window.DitaApp.lastDeliveryRecord.filename), before);
    await page.click('#closeHtmlPreviewButton');
  });
  await t.test('PDF endpoint enforces workspace and origin, and cannot fetch remote resources', async () => {
    const token = await page.evaluate(() => window.DitaApp.api.token), url = `http://127.0.0.1:${port}/api/export/pdf`;
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 409);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-workspace-token': token, origin: 'https://example.invalid' }, body: '{}' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-workspace-token': token }, body: '{"html":""}' })).status, 400);
    let requested = 0;
    const probe = http.createServer((req, res) => { requested++; res.end('probe'); }); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    try {
      const remote = `http://127.0.0.1:${probe.address().port}`;
      const response = await fetch(url, { method: 'POST', headers: { 'x-workspace-token': token }, body: JSON.stringify({ html: `<script>fetch('${remote}/script')</script><link rel="stylesheet" href="${remote}/style"><iframe src="${remote}/frame"></iframe><style>body{background-image:url(${remote}/css)}</style><p>SAFE_TEXT</p>` }) });
      assert.equal(response.status, 200); assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-'); assert.equal(requested, 0);
    } finally { await new Promise(resolve => probe.close(resolve)); }
  });
  assert.deepEqual(errors, []);
});
