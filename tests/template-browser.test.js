'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, spawnSync, execFileSync } = require('node:child_process'), { createHash } = require('node:crypto'), { chromium } = require('playwright-core');
const core = require('../public/template-core');

test('replaceable enterprise PDF templates', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-template-ui-')), repo = path.join(temp, 'docs'), templates = path.join(temp, 'templates');
  await fs.cp(path.join(__dirname, 'fixtures/manual'), repo, { recursive: true });
  const rows = Array.from({ length: 65 }, (_, i) => `<row><entry>AT+CHECK${i}</entry><entry>参数范围 ${i} 到 ${i + 16}，模块返回 OK 后继续发送下一条命令。</entry></row>`).join('');
  await fs.writeFile(path.join(repo, 'long.dita'), `<topic id="long"><title>长表格与分页</title><body><table><tgroup cols="2"><thead><row><entry>命令</entry><entry>说明</entry></row></thead><tbody>${rows}</tbody></tgroup></table></body></topic>`);
  const map = await fs.readFile(path.join(repo, 'main.ditamap'), 'utf8'); await fs.writeFile(path.join(repo, 'main.ditamap'), map.replace('</map>', '<topicref href="long.dita"/></map>'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' }); git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port), DITA_TEMPLATE_DIR: templates }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { if (browser) await browser.close(); if (child.exitCode == null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } }), errors = [];
  let publicationRequest;
  page.on('request', request => { if (request.url().endsWith('/api/export/pdf')) publicationRequest = request.postDataJSON(); });
  page.on('pageerror', error => errors.push(error.message));
  const start = async () => { await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root); await page.evaluate(() => window.DitaApp.openFile('main.ditamap')); };
  const delivery = async format => { await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor(); await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', format); await page.fill('#exportVersion', 'V3.0'); };
  const download = async () => { const waiting = page.waitForEvent('download', { timeout: 60000 }); await page.click('#modelExportForm [value=download]'); const file = await waiting; const bytes = await fs.readFile(await file.path()); await page.waitForFunction(() => !document.getElementById('modelExportDialog').open); return bytes; };
  const request = async (method, pack, headers = {}) => fetch('http://127.0.0.1:' + port + '/api/templates', { method, headers: { 'Content-Type': 'application/json', 'x-workspace-token': await page.evaluate(() => window.DitaApp.api.token), ...headers }, ...(pack ? { body: JSON.stringify(pack) } : {}) });
  await start();
  await t.test('A4 enterprise export captures exact template identity, metadata and model scope', async () => {
    await delivery('pdf'); await page.selectOption('#exportTemplate', 'enterprise-blue@1.1.0');
    assert.equal(await page.locator('#exportDate').inputValue(), '');
    await page.fill('#exportTitle', 'HTTP 技术手册'); await page.fill('#exportCompany', 'TEST COMPANY'); await page.fill('#exportDate', '2026-11-10'); await page.fill('#exportDocumentId', 'QA-001'); await page.fill('#exportClassification', '内部资料');
    assert.match(await page.locator('#exportTemplateInfo').innerText(), /未配置 Logo/);
    await page.click('#modelExportForm [value=check]'); await page.locator('[data-delivery-step=export]:enabled').waitFor();
    assert.match(await page.locator('#deliveryReadySummary').innerText(), /蓝绿/);
    const bytes = await download(); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const pages = bytes.toString('latin1').match(/\/Type \/Page\b/g) || []; assert.ok(pages.length >= 5, 'cover, contents and long-table pages exist');
    const boxes = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)/g)]; assert.ok(boxes.length);
    assert.ok(boxes.every(box => Math.abs(Number(box[1]) - 595.28) < 1 && Math.abs(Number(box[2]) - 841.89) < 1), 'every page uses A4');
    const record = await page.evaluate(() => window.DitaApp.lastDeliveryRecord);
    assert.equal(record.template.id, 'enterprise-blue'); assert.equal(record.template.fields['manual.model'], 'M100'); assert.equal(record.template.fields['manual.releaseDate'], '2026-11-10');
    assert.equal(record.template.sha256, createHash('sha256').update(JSON.stringify(core.builtins()[0])).digest('hex'));
    assert.equal(record.outputSha256, createHash('sha256').update(bytes).digest('hex'));
    if (process.env.DITA_TEMPLATE_QA_DIR) { await fs.mkdir(process.env.DITA_TEMPLATE_QA_DIR, { recursive: true }); await fs.writeFile(path.join(process.env.DITA_TEMPLATE_QA_DIR, 'enterprise-a4.pdf'), bytes); }
  });
  await t.test('changing a template or cover field invalidates the previous check', async () => {
    await delivery('pdf'); await page.click('#modelExportForm [value=check]'); await page.locator('[data-delivery-step=export]:enabled').waitFor();
    await page.click('[data-delivery-step=configure]'); await page.fill('#exportDocumentId', 'QA-002'); assert.equal(await page.locator('[data-delivery-step=export]').isDisabled(), true);
    await page.selectOption('#exportTemplate', 'enterprise-paper@1.1.0'); await page.click('#modelExportForm [value=check]'); await page.locator('[data-delivery-step=export]:enabled').waitFor();
    await page.click('[data-delivery-step=configure]'); assert.equal(await page.locator('#exportDocumentId').inputValue(), 'QA-002'); await page.click('#modelExportCancel');
  });
  await t.test('PDF watermark geometry is sheet-relative and footers retain their edge clearance', { skip: Boolean(spawnSync('pdftoppm', ['-v']).error) }, async () => {
    const art = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 100; const context = canvas.getContext('2d'); context.fillStyle = '#ff00ff'; context.fillRect(0, 0, 300, 100); return canvas.toDataURL('image/png'); });
    const document = require('../public/delivery-document').renderHtmlDocument({ title: 'Geometry', sections: [{ title: 'Chapter', body: '<p>BODY_TEXT</p>' }] });
    const html = await page.evaluate(html => window.DitaOfficeExport.printable(html), document), token = await page.evaluate(() => window.DitaApp.api.token);
    for (const size of ['A4', 'Letter']) {
      const pack = core.builtins()[0]; pack.page.size = size; pack.page.marginsMm = { top: 30, right: 15, bottom: 24, left: 30 }; pack.cover.enabled = false;
      pack.assets['assets/mark.png'] = art; pack.watermark = { ...pack.watermark, source: 'image', asset: 'assets/mark.png', opacity: 1, widthPercent: 60, offsetYPercent: 52, tone: 'original' };
      const publication = core.capture(pack, { 'manual.title': 'Geometry', 'manual.documentId': 'FOOTER_ID' });
      const response = await fetch('http://127.0.0.1:' + port + '/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-token': token }, body: JSON.stringify({ html, publication }) }); assert.equal(response.status, 200);
      const file = path.join(temp, 'geometry-' + size + '.pdf'), raster = path.join(temp, 'geometry-' + size); await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
      execFileSync('pdftoppm', ['-f', '2', '-l', '2', '-r', '72', '-singlefile', '-png', file, raster]);
      const image = (await fs.readFile(raster + '.png')).toString('base64');
      const box = await page.evaluate(async data => { const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; let left = canvas.width, right = 0, top = canvas.height, bottom = 0; for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4; if (pixels[i] > 200 && pixels[i + 1] < 80 && pixels[i + 2] > 200) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); } } return { left, right, top, bottom, width: canvas.width, height: canvas.height }; }, image);
      assert.ok(Math.abs((box.left + box.right) / 2 - box.width / 2) < 3, size + ' watermark horizontal center');
      assert.ok(Math.abs((box.top + box.bottom) / 2 - box.height * 0.52) < 3, size + ' watermark vertical position');
      assert.ok(Math.abs((box.right - box.left) - box.width * 0.6) < 3, size + ' watermark width without clipping');
      assert.ok(Math.abs((box.right - box.left) / (box.bottom - box.top) - 3) < 0.05, size + ' original logo ratio');
      const xml = execFileSync('pdftotext', ['-f', '2', '-l', '2', '-bbox', file, '-'], { encoding: 'utf8' }), words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)];
      const footer = words.find(word => word[5] === 'FOOTER_ID'); assert.ok(footer); assert.ok(Math.abs(Number(footer[1]) - 30 * 72 / 25.4) < 2);
      assert.ok(Number(footer[2]) > box.height - (24 - 6) * 72 / 25.4, 'footer starts after reserved content gap'); assert.ok(Number(footer[4]) < box.height - 5 * 72 / 25.4, 'footer clears paper edge');
    }
  });
  await t.test('Letter paper, cover and watermark toggles operate independently; damaged raster images fail visibly', async () => {
    const pack = core.builtins()[1]; pack.page.size = 'Letter'; pack.cover.enabled = false; pack.watermark.enabled = false; pack.regions.frontMatter.footer = true; pack.footer.center = 'page.currentTotal';
    const token = await page.evaluate(() => window.DitaApp.api.token), send = publication => fetch('http://127.0.0.1:' + port + '/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workspace-token': token }, body: JSON.stringify({ html: publicationRequest.html, publication }) });
    const publication = core.capture(pack, publicationRequest.publication.fields), response = await send(publication);
    assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); const boxes = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)/g)]; assert.ok(boxes.length); assert.ok(boxes.every(box => Math.abs(Number(box[1]) - 612) < 1 && Math.abs(Number(box[2]) - 792) < 1));
    if (process.env.DITA_TEMPLATE_QA_DIR) await fs.writeFile(path.join(process.env.DITA_TEMPLATE_QA_DIR, 'plain-letter.pdf'), bytes);
    const broken = core.builtins()[0]; broken.company.logo = 'assets/bad.png'; broken.assets['assets/bad.png'] = 'data:image/png;base64,iVBORw0KGgoAAA==';
    const failure = await send({ package: broken, fields: publication.fields }); assert.equal(failure.status, 400); assert.match((await failure.json()).error, /图片/);
  });
  let custom;
  await t.test('authors save a custom template, upload images and share an exact portable package', async () => {
    await delivery('pdf'); await page.click('#templateManage'); await page.fill('#templateId', 'test-brand'); await page.fill('#templateName', '测试企业版式'); await page.fill('#templateCompany', 'TEST BRAND');
    await page.getByText('页眉、页脚与正文设置', { exact: true }).click(); await page.selectOption('#templateHeaderLeft', 'manual.title'); await page.selectOption('#templateFooterCenter', 'page.currentTotal');
    const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 80; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 300, 80); ctx.fillStyle = '#145A78'; ctx.font = '32px sans-serif'; ctx.fillText('TEST BRAND', 20, 52); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('#templateLogo', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }); await page.getByText('assets/logo.png', { exact: true }).waitFor();
    assert.equal(await page.locator('#templateWatermarkPicture').isVisible(), true); assert.equal(await page.locator('#templateWatermarkText').isVisible(), false);
    assert.equal(await page.locator('#templateWatermarkPicture').evaluate(image => image.src.split(',')[1]), data);
    await page.selectOption('#templateWatermarkSource', 'text'); assert.equal(await page.locator('#templateWatermarkText').isVisible(), true);
    await page.selectOption('#templateWatermarkSource', 'auto'); await page.fill('#templateFooterGap', '7');
    await page.setInputFiles('#templateWatermarkImage', { name: 'watermark.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }); await page.getByText('assets/watermark.png', { exact: true }).waitFor();
    const background = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eef3f2'; ctx.fillRect(0, 0, 300, 400); return canvas.toDataURL('image/jpeg').split(',')[1]; });
    await page.setInputFiles('#templateBackground', { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(background, 'base64') }); await page.getByText('assets/cover.jpg', { exact: true }).waitFor();
    await page.click('#templateSave'); await page.waitForFunction(() => !document.getElementById('templateDialog').open);
    assert.equal(await page.locator('#exportTemplate').inputValue(), 'test-brand@1.0.0');
    const waiting = page.waitForEvent('download'); await page.click('#templateShare'); const file = await waiting; custom = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
    assert.equal(custom.id, 'test-brand'); assert.ok(custom.assets['assets/logo.png']); assert.equal(custom.company.name, 'TEST BRAND');
    assert.equal(custom.header.left, 'manual.title'); assert.equal(custom.footer.center, 'page.currentTotal');
    assert.equal(custom.renderer, 'manual-v2'); assert.equal(custom.footer.gapMm, 7); assert.equal(custom.watermark.rotationDeg, 0);
    assert.deepEqual(core.normalizePackage(custom), custom); assert.deepEqual(JSON.parse(await fs.readFile(path.join(templates, 'test-brand@1.0.0.json'), 'utf8')), custom);
    if (process.env.DITA_TEMPLATE_QA_DIR) { await page.screenshot({ path: path.join(process.env.DITA_TEMPLATE_QA_DIR, 'template-picker.png') }); await page.click('#templateManage'); await page.screenshot({ path: path.join(process.env.DITA_TEMPLATE_QA_DIR, 'template-editor.png') }); await page.click('#templateClose'); }
    await page.click('#modelExportCancel');
  });
  await t.test('template preferences survive reload and same-version imports cannot overwrite installed content', async () => {
    await start(); await delivery('pdf'); assert.equal(await page.locator('#exportTemplate').inputValue(), 'test-brand@1.0.0'); assert.equal(await page.locator('#exportCompany').inputValue(), 'TEST BRAND');
    assert.equal((await request('POST', { ...custom, name: 'conflicting' })).status, 409); assert.equal((await request('POST', custom)).status, 201);
    assert.equal((await request('POST', custom, { origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await fetch('http://127.0.0.1:' + port + '/api/templates')).status, 409);
    assert.equal((await request('POST', { ...custom, renderer: 'run-code' })).status, 400);
    await page.click('#templateManage'); const imported = { ...custom, version: '1.1.0' }; await page.setInputFiles('#templateImport', { name: 'brand.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction(() => document.getElementById('templateVersion').value === '1.1.0'); await page.click('#templateSave'); await page.waitForFunction(() => !document.getElementById('templateDialog').open);
    assert.equal(await page.locator('#exportTemplate').inputValue(), 'test-brand@1.1.0');
    const bytes = await download(); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.equal((await page.evaluate(() => window.DitaApp.lastDeliveryRecord.template)).version, '1.1.0');
    const markup = await page.evaluate(input => window.DitaTemplatePdf.render(input.html, input.publication), publicationRequest), preview = await browser.newPage();
    try { await preview.emulateMedia({ media: 'print' }); await preview.setContent(markup); assert.match(await preview.locator('.template-cover').evaluate(node => getComputedStyle(node).backgroundImage), /^url\("data:image\/jpeg/); }
    finally { await preview.close(); }
    if (process.env.DITA_TEMPLATE_QA_DIR) await fs.writeFile(path.join(process.env.DITA_TEMPLATE_QA_DIR, 'custom-with-assets.pdf'), bytes);
  });
  await t.test('missing bound templates require an explicit replacement and narrow/dark controls fit', async () => {
    await fs.rename(path.join(templates, 'test-brand@1.1.0.json'), path.join(templates, 'test-brand@1.1.0.backup'));
    await start(); await delivery('pdf'); assert.equal(await page.locator('#exportTemplate').inputValue(), 'test-brand@1.1.0'); assert.match(await page.locator('#exportTemplateWarning').innerText(), /原绑定模板不可用/);
    await page.click('#modelExportForm [value=check]'); await page.waitForFunction(() => document.getElementById('modelExportError').textContent.includes('模板不可用'));
    await page.click('[data-delivery-step=configure]'); await page.selectOption('#exportTemplate', 'enterprise-blue@1.1.0');
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.click('#templateManage');
    const box = await page.locator('#templateDialog').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391);
    assert.equal(await page.locator('#templateDialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    if (process.env.DITA_TEMPLATE_QA_DIR) await page.screenshot({ path: path.join(process.env.DITA_TEMPLATE_QA_DIR, 'template-mobile.png') });
    await page.click('#templateClose'); await page.setViewportSize({ width: 1440, height: 1000 }); await page.click('#modelExportCancel');
  });
  await t.test('legacy import retains its exact package until an explicit layout upgrade', async () => {
    await delivery('pdf'); await page.click('#templateManage');
    const original = core.builtins().find(pack => pack.renderer === 'manual-v1');
    const legacy = { ...original, id: 'legacy-brand', watermark: { ...original.watermark, opacity: 0.065 } };
    await page.setInputFiles('#templateImport', { name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) }); await page.locator('#templateUpgrade:not([hidden])').waitFor();
    assert.equal(await page.locator('#templateWatermarkSource').isDisabled(), true);
    const waiting = page.waitForEvent('download'); await page.click('#templateDownload'); const file = await waiting;
    assert.deepEqual(JSON.parse(await fs.readFile(await file.path(), 'utf8')), legacy);
    await page.click('#templateSave'); await page.waitForFunction(() => !document.getElementById('templateDialog').open); assert.equal(await page.locator('#exportTemplate').inputValue(), 'legacy-brand@1.0.0');
    await page.click('#templateManage'); await page.setInputFiles('#templateImport', { name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) }); await page.locator('#templateUpgrade:not([hidden])').waitFor();
    await page.click('#templateUpgrade'); assert.equal(await page.locator('#templateVersion').inputValue(), '1.0.1'); assert.equal(await page.locator('#templateWatermarkSource').isEnabled(), true);
    await page.selectOption('#templateWatermarkSource', 'image'); await page.locator('details').filter({ has: page.getByText('水印尺寸与位置', { exact: true }) }).evaluate(node => node.open = true); await page.selectOption('#templateWatermarkFit', 'page'); await page.fill('#templateOpacity', '100');
    await page.click('#templateSave'); await page.waitForFunction(() => !document.getElementById('templateDialog').open);
    const upgraded = JSON.parse(await fs.readFile(path.join(templates, 'legacy-brand@1.0.1.json'), 'utf8'));
    assert.equal(upgraded.renderer, 'manual-v2'); assert.equal(upgraded.watermark.opacity, 1); assert.deepEqual(JSON.parse(await fs.readFile(path.join(templates, 'legacy-brand@1.0.0.json'), 'utf8')), legacy);
    await page.click('#modelExportCancel');
  });
  await t.test('Word retains its own content pipeline and cannot be mislabeled as a branded export', async () => {
    await delivery('docx'); assert.equal(await page.locator('#exportTemplatePanel').isVisible(), false);
    const bytes = await download(); assert.equal(bytes.subarray(0, 2).toString(), 'PK'); assert.equal((await page.evaluate(() => window.DitaApp.lastDeliveryRecord)).template, null);
  });
  assert.deepEqual(errors, []);
});
