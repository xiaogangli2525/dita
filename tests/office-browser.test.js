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
const templateCore = require('../public/template-core');
const { renderHtmlDocument } = require('../public/delivery-document');

async function inspectWord(page, bytes) {
  const parts = Object.fromEntries(Object.entries(unzipSync(bytes)).filter(([name]) => name.endsWith('.xml') || name.endsWith('.rels')).map(([name, value]) => [name, strFromU8(value)]));
  return page.evaluate(parts => {
    const parse = name => new DOMParser().parseFromString(parts[name], 'application/xml');
    const doc = parse('word/document.xml'), relationships = parse('word/_rels/document.xml.rels');
    const elements = (node, name) => [...node.getElementsByTagName(name)];
    const text = node => elements(node, 'w:t').map(item => item.textContent).join('');
    const inspectPart = (section, kind) => {
      const reference = elements(section, 'w:' + kind + 'Reference').find(node => node.getAttribute('w:type') === 'default');
      if (!reference) return null;
      const relation = elements(relationships, 'Relationship').find(node => node.getAttribute('Id') === reference.getAttribute('r:id'));
      const content = parse('word/' + relation.getAttribute('Target'));
      return {
        id: reference.getAttribute('r:id'), text: text(content),
        anchors: elements(content, 'wp:anchor').map(anchor => {
          const extent = elements(anchor, 'wp:extent')[0], position = elements(anchor, 'wp:positionV')[0];
          return {
            topMm: Number(elements(position, 'wp:posOffset')[0].textContent) / 36000,
            widthMm: Number(extent.getAttribute('cx')) / 36000,
            heightMm: Number(extent.getAttribute('cy')) / 36000,
            rotation: Number(elements(anchor, 'a:xfrm')[0].getAttribute('rot') || 0) / 60000
          };
        })
      };
    };
    return {
      sections: elements(doc, 'w:sectPr').map(section => ({ header: inspectPart(section, 'header'), footer: inspectPart(section, 'footer') })),
      runs: elements(doc, 'w:r').filter(run => elements(run, 'w:t').length).map(run => ({
        text: text(run), font: elements(run, 'w:rFonts')[0]?.getAttribute('w:ascii'),
        paragraphStyle: elements(run.parentNode, 'w:pStyle')[0]?.getAttribute('w:val'),
        sizePt: Number(elements(run, 'w:sz')[0]?.getAttribute('w:val')) / 2,
        color: elements(run, 'w:color')[0]?.getAttribute('w:val'),
        bold: elements(run, 'w:b').length > 0, italic: elements(run, 'w:i').length > 0
      })),
      images: elements(doc, 'wp:inline').map(image => {
        const extent = elements(image, 'wp:extent')[0];
        return { widthMm: Number(extent.getAttribute('cx')) / 36000, heightMm: Number(extent.getAttribute('cy')) / 36000 };
      })
    };
  }, parts);
}

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
    if (format === 'docx') assert.match(await page.locator('#exportFormatHint').innerText(), /更新整个目录/);
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('#modelExportForm [value=download]');
    const download = await downloadPromise, bytes = await fs.readFile(await download.path());
    assert.equal(download.suggestedFilename(), `main-${model}-V3-0.${format}`);
    assert.ok(bytes.length > 5000);
    if (format === 'pdf') { assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3); }
    else {
      const zip = unzipSync(bytes), xml = strFromU8(zip['word/document.xml']);
      assert.match(xml, /w:w="11906" w:h="16838"/, 'enterprise template applies A4 page size');
      assert.match(xml, /TECHNICAL DOCUMENTATION/, 'enterprise cover is native editable Word text');
      assert.match(xml, /TOC .*\\o &quot;1-3&quot;.*\\z/, 'Word contains an updatable native table-of-contents field');
      assert.match(xml, /TOC .*\\h/, 'Word TOC entries are configured as hyperlinks');
      assert.match(xml, /PAGEREF _Toc\d+ \\h/, 'TOC entries contain page-number fields and internal links');
      assert.match(xml, /w:name="_Toc\d+"/, 'TOC headings have stable Word bookmarks');
      assert.ok(Object.keys(zip).some(key => /^word\/header\d+\.xml$/.test(key)), 'template includes native Word headers');
      assert.ok(Object.keys(zip).some(key => /^word\/footer\d+\.xml$/.test(key)), 'template includes native Word footers');
      const footer = Object.keys(zip).filter(key => /^word\/footer\d+\.xml$/.test(key)).map(key => strFromU8(zip[key])).join('');
      assert.match(footer, /PAGE/); assert.match(footer, /NUMPAGES/);
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
  const baseTemplate = () => structuredClone(templateCore.builtins().find(pack => pack.id === 'enterprise-blue' && pack.version === '1.2.0'));
  const artwork = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 840;
    const context = canvas.getContext('2d'); context.fillStyle = '#145A78'; context.fillRect(0, 0, 600, 840);
    context.fillStyle = '#FFFFFF'; context.font = '40px Arial'; context.fillText('WATERMARK', 30, 80);
    const whole = canvas.toDataURL('image/png'); canvas.width = 1000; canvas.height = 200;
    context.fillStyle = '#7DB47B'; context.fillRect(0, 0, 1000, 200); context.fillStyle = '#202B33'; context.font = '32px Arial'; context.fillText('IMAGE EDGES', 30, 80);
    return { whole, logo: canvas.toDataURL('image/png') };
  });
  const renderWord = async (pack, body, name, fields = {}) => {
    const html = renderHtmlDocument({ title: 'Word 模板验收', sections: [{ title: '主题标题', body }] });
    const bytes = Buffer.from(await page.evaluate(async ({ pack, html, fields }) => {
      const publication = pack ? window.DitaTemplateCore.capture(pack, { 'manual.title': 'Word 模板验收', 'company.name': 'REGION COMPANY', 'manual.documentId': 'REGION DOCUMENT', ...fields }) : null;
      const blob = await window.DitaOfficeExport.word(html, null, publication);
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, { pack, html, fields }));
    if (process.env.DITA_OFFICE_QA_DIR && name) await fs.writeFile(path.join(process.env.DITA_OFFICE_QA_DIR, name + '.docx'), bytes);
    return inspectWord(page, bytes);
  };
  await t.test('Word watermarks remain sheet-centred for A4/Letter and whole-page artwork ignores logo rotation', async () => {
    for (const size of ['A4', 'Letter']) for (const fit of ['page', 'logo']) {
      const pack = baseTemplate(); pack.page.size = size; pack.cover.enabled = false;
      pack.assets['assets/watermark.png'] = fit === 'page' ? artwork.whole : artwork.logo;
      pack.watermark = { ...pack.watermark, source: 'image', asset: 'assets/watermark.png', fit, offsetYPercent: 53, rotationDeg: 25 };
      const result = await renderWord(pack, '<p>水印位置验收</p>', `watermark-${size}-${fit}`), pageHeight = templateCore.sizes[size][1];
      for (const section of result.sections) {
        const [image] = section.header.anchors; assert.ok(image);
        const expectedCentre = pageHeight * (fit === 'page' ? 0.5 : 0.53);
        assert.ok(Math.abs(image.topMm + image.heightMm / 2 - expectedCentre) < 0.03, 'watermark centre matches its configured sheet position');
        assert.ok(image.topMm >= -0.03 && image.topMm + image.heightMm <= pageHeight + 0.03, 'unrotated image bounds remain on the sheet');
        assert.equal(image.rotation, fit === 'page' ? 0 : 25);
      }
    }
  });
  await t.test('each Word section owns its header/footer references across all region on/off transitions', async () => {
    for (let mask = 0; mask < 8; mask++) {
      const pack = baseTemplate(); pack.cover.enabled = false;
      pack.assets['assets/watermark.png'] = artwork.logo;
      pack.watermark = { ...pack.watermark, source: 'image', asset: 'assets/watermark.png' };
      const front = { header: Boolean(mask & 1), footer: Boolean(mask & 2), watermark: Boolean(mask & 4) };
      const body = Object.fromEntries(Object.entries(front).map(([key, enabled]) => [key, !enabled]));
      pack.regions.frontMatter = front; pack.regions.body = body;
      const result = await renderWord(pack, '<p>分区验收</p>', mask === 7 ? 'regions-on-off' : null);
      assert.equal(result.sections.length, 2);
      for (const [index, expected] of [front, body].entries()) {
        const { header, footer } = result.sections[index]; assert.ok(header); assert.ok(footer);
        assert.equal(header.text.includes('REGION COMPANY'), expected.header);
        assert.equal(footer.text.includes('REGION DOCUMENT'), expected.footer);
        assert.equal(header.anchors.length, expected.watermark ? 1 : 0);
      }
      assert.notEqual(result.sections[0].header.id, result.sections[1].header.id);
      assert.notEqual(result.sections[0].footer.id, result.sections[1].footer.id);
    }
    const pack = baseTemplate(); pack.assets['assets/cover.png'] = artwork.whole; pack.cover.background = 'assets/cover.png';
    pack.regions.frontMatter = pack.regions.body = { header: false, footer: false, watermark: false };
    const result = await renderWord(pack, '<p>封面背景不能进入目录或正文</p>', 'cover-background-regions');
    assert.equal(result.sections[0].header.anchors.length, 1);
    assert.ok(result.sections.slice(1).every(section => section.header.anchors.length === 0 && section.header.text === '' && section.footer.text === ''));
  });
  await t.test('Word template typography and colours apply to body text without losing inline emphasis or code fonts', async () => {
    for (const [font, sizePt] of [['Arial', 9], ['Noto Sans CJK SC', 13]]) {
      const pack = baseTemplate(); pack.cover.enabled = false;
      pack.typography = { bodyFont: font, bodySizePt: sizePt }; pack.colors.text = '#AA1234'; pack.colors.primary = '#008866';
      const result = await renderWord(pack, '<p>FONT_CHECK <strong>BOLD_CHECK</strong> <em>ITALIC_CHECK</em></p><pre><code>AT+CODE_CHECK</code></pre>', `typography-${sizePt}`);
      const run = result.runs.find(run => run.text.trim() === 'FONT_CHECK');
      assert.equal(run.font, font); assert.equal(run.sizePt, sizePt); assert.equal(run.color, 'AA1234');
      assert.equal(result.runs.find(run => run.text === '主题标题' && run.paragraphStyle === 'Heading1').color, '008866');
      assert.equal(result.runs.find(run => run.text === 'BOLD_CHECK').bold, true);
      assert.equal(result.runs.find(run => run.text === 'ITALIC_CHECK').italic, true);
      assert.match(result.runs.find(run => run.text === 'AT+CODE_CHECK').font, /Consolas/);
    }
  });
  await t.test('Word body images fit the selected paper and margins while the basic layout retains its width limit', async () => {
    for (const [size, margin] of [['A4', 40], ['Letter', 40], ['A4', 12]]) {
      const pack = baseTemplate(); pack.cover.enabled = false; pack.page.size = size;
      pack.page.marginsMm.left = pack.page.marginsMm.right = margin;
      const result = await renderWord(pack, `<p><img src="${artwork.logo}"/></p>`, `body-image-${size}-${margin}`);
      const [image] = result.images, contentWidth = templateCore.sizes[size][0] - 2 * margin;
      assert.ok(image.widthMm <= contentWidth + 0.03 && image.widthMm >= contentWidth - 0.3, 'wide image fits the actual content area within twip rounding');
      assert.ok(Math.abs(image.widthMm / image.heightMm - 5) < 0.04, 'image keeps its aspect ratio');
    }
    const result = await renderWord(null, `<p><img src="${artwork.logo}"/></p>`);
    assert.ok(Math.abs(result.images[0].widthMm - 165.1) < 0.03);
  });
  await t.test('long Word cover titles retain all text, optional model fields stay omitted and oversized metadata is rejected', async () => {
    const title = '通信模组功能配置与网络协议应用开发指南'.repeat(9).slice(0, 160);
    for (const size of ['A4', 'Letter']) {
      const pack = baseTemplate(); pack.page.size = size; pack.cover.fields = ['manual.title'];
      const result = await renderWord(pack, '<p>正文</p>', 'long-cover-' + size, { 'manual.title': title, 'manual.model': 'COVER_MODEL_OMITTED' });
      assert.ok(result.runs.some(run => run.text === title && run.sizePt <= 20));
      assert.ok(result.runs.every(run => !run.text.includes('COVER_MODEL_OMITTED')));
    }
    const pack = baseTemplate(); pack.page.size = 'Letter'; pack.page.marginsMm = { top: 40, right: 40, bottom: 40, left: 40 };
    pack.assets['assets/logo.png'] = artwork.logo; pack.company.logo = 'assets/logo.png';
    await assert.rejects(renderWord(pack, '<p>正文</p>', null, { 'manual.title': title, 'company.name': '企业名称'.repeat(25), 'manual.model': '型号'.repeat(50), 'manual.version': '版本'.repeat(50), 'manual.documentId': '文档编号'.repeat(25), 'manual.classification': '文档级别'.repeat(25) }), /封面信息超出一页/);
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
    const before = await page.evaluate(async () => { const a = window.DitaApp, workspace = await (await a.api.request('/api/workspace')).json(); a.session.refreshDirectory({ ...workspace, capabilities: { ...workspace.capabilities, pdf: false } }); return a.lastDeliveryRecord.filename; });
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
