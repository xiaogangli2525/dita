'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('real browser editing, reading and review workflow', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-browser-'));
  const root = path.join(temporary, 'docs');
  await fs.mkdir(root);
  const initial = '<topic id="a"><title>Title</title><body><p>Original</p></body></topic>';
  const deleted = '<p>' + 'deleted content '.repeat(40) + '</p>';
  const oxygen = '<topic id="oxy"><title>Oxygen</title><body><p><?oxy_insert_start author="A"?>Inserted<?oxy_insert_end?></p><?oxy_delete author="A" content="' + deleted.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"?></body></topic>';
  await fs.writeFile(path.join(root, 'a.dita'), initial);
  await fs.writeFile(path.join(root, 'oxy.dita'), oxygen);
  await fs.writeFile(path.join(root, 'main.ditamap'), '<map><title>Map</title><topicref href="a.dita"/><topicref href="oxy.dita"/></map>');
  await fs.cp(path.join(__dirname, 'fixtures/manual'), path.join(root, 'manual'), { recursive: true });
  await fs.rename(path.join(root, 'manual/main.ditamap'), path.join(root, 'manual/mqtt-acceptance.ditamap'));
  const gbkPath = path.join(root, 'manual/topics/publish.dita');
  await fs.writeFile(gbkPath, require('iconv-lite').encode(await fs.readFile(gbkPath, 'utf8'), 'gbk'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: root, REPOSITORIES_ROOT: temporary, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (child.exitCode == null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 10000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('error', reject);
  });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const writes = [];
  page.on('request', request => { if (/\/api\/file$/.test(request.url()) && ['PUT', 'POST'].includes(request.method())) writes.push(request.url()); });
  await page.goto('http://127.0.0.1:' + port);
  await page.waitForFunction(() => window.DitaApp?.state.root);
  const open = async file => {
    await page.click('[data-view="search"]');
    await page.fill('#workspaceSearchInput', file);
    await page.locator('.workspace-result').filter({ hasText: file }).click();
    await page.waitForFunction(file => window.DitaApp.state.activePath === file, file);
  };
  const current = () => page.evaluate(() => { const a = window.DitaApp; return a.state.filesMap.get(a.state.activePath).current; });
  const source = async text => { await page.click('#sourceButton'); await page.fill('#editor', text); };
  const undo = async () => { await page.click('#sourceButton'); await page.focus('#editor'); await page.keyboard.press('Control+z'); };

  await t.test('reading is read-only for a Topic and every Map surface', async () => {
    await open('a.dita');
    await page.click('#previewButton');
    assert.equal(await page.locator('#visualEditor').getAttribute('contenteditable'), 'false');
    await page.locator('#visualEditor p').click(); await page.keyboard.type('should not edit');
    assert.equal(await current(), initial);
    await open('main.ditamap'); await page.click('#previewButton');
    await page.waitForSelector('.map-topic-surface');
    assert.equal(await page.locator('#visualEditor [contenteditable="true"]').count(), 0);
    assert.equal(writes.length, 0);
  });
  await t.test('Chinese visual input and pasted text share undo/redo', async () => {
    await open('a.dita'); await page.click('#visualButton');
    await page.locator('#visualEditor p').click(); await page.keyboard.press('End');
    await page.keyboard.insertText('中文输入');
    assert.match(await current(), /中文输入/);
    await page.keyboard.press('Control+z'); assert.equal(await current(), initial);
    await page.keyboard.press('Control+y'); assert.match(await current(), /中文输入/);
    await page.locator('#visualEditor p').click(); await page.keyboard.press('End');
    await page.evaluate(() => navigator.clipboard.writeText(' pasted text'));
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.DitaApp.state.filesMap.get('a.dita').current.includes('pasted text'));
    await page.keyboard.press('Control+z'); assert.doesNotMatch(await current(), /pasted text/);
  });
  await t.test('formatting preserves code indentation, inline spaces, encoding and outer comments', async () => {
    const code = '<codeblock>if ok:\n    if ready:\n        run()</codeblock>';
    const content = '<?xml version="1.0" encoding="GBK"?>\n<!--keep-->\n<topic id="a"><title>T</title><body>' + code + '<p><b>A</b> <i>B</i></p></body></topic>\n<?end test?>';
    await source(content);
    await page.click('.editing-tools summary'); await page.click('#formatButton');
    const result = await current();
    assert.ok(result.includes(code)); assert.ok(result.includes('<b>A</b> <i>B</i>'));
    assert.ok(result.startsWith('<?xml version="1.0" encoding="GBK"?>\n<!--keep-->'));
    assert.ok(result.endsWith('<?end test?>'));
    await undo(); assert.equal(await current(), content);
  });
  await t.test('table row editing uses the same undo history', async () => {
    const table = '<topic id="a"><title>Table</title><body><table><tgroup cols="2"><tbody><row><entry>A</entry><entry>B</entry></row></tbody></tgroup></table></body></topic>';
    await source(table); await page.click('#visualButton');
    await page.locator('#visualEditor td').first().click();
    await page.click('[data-context-action="row-after"]');
    assert.equal((await current()).match(/<row/g).length, 2);
    await undo(); assert.equal(await current(), table);
    await page.click('#visualButton'); await page.locator('#visualEditor td').first().click();
    await page.click('[data-context-action="col-after"]');
    assert.match(await current(), /cols="3"/);
    assert.equal((await current()).match(/<entry/g).length, 3);
    await undo(); assert.equal(await current(), table);
  });
  await t.test('model footnotes support filtering, exact-source edits, undo, stale protection and full export', async () => {
    const notes = '<topic id="a"><title>MQTT</title><body><p>AT+MQTTOPEN<fn product="M100">Limit &amp; retry.</fn></p><p>AT+MQTTPUB<fn>Legacy unassigned.</fn></p><p>AT+MQTTSUB<fn product="M200">Keep <xref href="a.dita">link</xref>.</fn></p></body></topic>';
    await source(notes); await page.click('#footnotesButton');
    await page.waitForFunction(() => document.getElementById('footnoteCount').textContent === '3');
    await page.selectOption('#footnoteModel', 'M100');
    assert.equal(await page.locator('.footnote-card').count(), 2);
    assert.match(await page.locator('#footnoteList').innerText(), /Legacy unassigned/);
    const before = writes.length;
    await page.locator('.footnote-edit-button').first().click();
    await page.fill('#footnoteContent', 'Revised & exact.');
    await page.fill('#footnoteProducts', 'M100 M300');
    await page.click('#footnoteEditForm button[type="submit"]');
    const revised = notes.replace('product="M100">Limit &amp; retry.', 'product="M100 M300">Revised &amp; exact.');
    assert.equal(await current(), revised); assert.equal(writes.length, before);
    await undo(); assert.equal(await current(), notes);
    await page.keyboard.press('Control+y'); assert.equal(await current(), revised);
    // Prove full source snapshots protect edits opened before another change.
    await page.click('#footnoteRefresh');
    await page.waitForFunction(() => document.querySelector('.footnote-text')?.textContent === 'Revised & exact.');
    await page.locator('.footnote-edit-button').first().click();
    await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get('a.dita'); a.setFileContent(f, f.current.replace('Legacy unassigned.', 'Changed elsewhere.')); });
    await page.fill('#footnoteContent', 'Stale edit'); await page.click('#footnoteEditForm button[type="submit"]');
    assert.match(await page.locator('#footnoteEditError').innerText(), /文档已变化/);
    await page.click('#footnoteCancel');
    // Opening a Map indexes the complete manual; locating one topic retains its scope.
    await open('main.ditamap'); await page.click('#footnotesButton');
    await page.waitForFunction(() => document.getElementById('footnoteCount').textContent === '3');
    await page.selectOption('#footnoteModel', '');
    await page.locator('.footnote-actions button').first().click();
    await page.waitForFunction(() => window.DitaApp.state.activePath === 'a.dita');
    assert.equal(await page.locator('#footnoteScope').innerText(), 'main.ditamap');
    assert.match(await page.locator('#editor').inputValue(), /Changed elsewhere/);
    assert.match(await page.locator('.footnote-located').innerText(), /AT\+MQTTOPEN/);
    await page.locator('.footnote-edit-button').last().click();
    assert.match(await page.locator('#footnoteContentLabel').innerText(), /XML/);
    assert.match(await page.locator('#footnoteContent').inputValue(), /<xref href="a.dita">link<\/xref>/);
    await page.fill('#footnoteProducts', 'M200 M300'); await page.click('#footnoteEditForm button[type="submit"]');
    assert.match(await current(), /product="M200 M300"/); assert.match(await current(), /<xref href="a.dita">link<\/xref>/);
    await open('main.ditamap'); await page.click('#exportMenuButton'); await page.click('#previewHtmlButton');
    await page.waitForFunction(() => document.getElementById('htmlPreviewFrame').src.startsWith('blob:'));
    const frame = page.frameLocator('#htmlPreviewFrame');
    await frame.locator('.export-footnotes').waitFor();
    assert.match(await frame.locator('.export-footnotes').innerText(), /Revised & exact/);
    assert.match(await frame.locator('.export-footnotes').innerText(), /Changed elsewhere/);
    await page.click('#closeHtmlPreviewButton');
    await page.click('#propertiesTab'); await open('a.dita'); await source(initial);
  });
  await t.test('model HTML preview and MD download use one scope, valid references and unchanged sources', async () => {
    try {
    const publication = '<topic id="a"><title>Publication</title><body><p>Body<fn product="M100">A ONLY</fn><fn product="M200">B ONLY</fn><fn>UNKNOWN NOTE</fn></p><fn id="n" product="M100">SHARED NOTE</fn><p>One<xref href="#a/n" type="fn"/> Two<xref href="#a/n" type="fn"/></p></body></topic>';
    await open('a.dita'); await source(publication); await open('main.ditamap');
    await page.click('#exportMenuButton'); await page.click('#modelExportButton');
    await page.selectOption('#exportModel', 'M100');
    assert.match(await page.locator('#modelExportSummary').innerText(), /包含 3 条.*排除 1 条.*保留 1 条/);
    await page.click('#modelExportForm button[value="preview"]');
    const frame = page.frameLocator('#htmlPreviewFrame'); await frame.locator('.export-footnotes').waitFor();
    const html = await frame.locator('body').innerText();
    assert.match(html, /A ONLY/); assert.match(html, /UNKNOWN NOTE/); assert.doesNotMatch(html, /B ONLY/);
    assert.equal(await frame.locator('#fn-3').count(), 1);
    assert.equal(await frame.locator('a[href="#fn-3"]').count(), 2);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), publication);
    await page.click('#closeHtmlPreviewButton');
    await page.click('#exportMenuButton'); await page.click('#modelExportButton');
    await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', 'md');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#modelExportForm button[value="download"]');
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'main-M100.md');
    const md = await fs.readFile(await download.path(), 'utf8');
    assert.match(md, /A ONLY/); assert.match(md, /UNKNOWN NOTE/); assert.doesNotMatch(md, /B ONLY/);
    assert.match(md, /One\[\^3\] Two\[\^3\]/);
    // A buffered edit after the dialog has captured its snapshot must invalidate it.
    await page.click('#exportMenuButton'); await page.click('#modelExportButton');
    await page.locator('#modelExportDialog').waitFor({ state: 'visible' });
    await page.evaluate(() => { const a = window.DitaApp, f = a.state.filesMap.get('a.dita'); a.setFileContent(f, f.current.replace('A ONLY', 'NEWER')); });
    await page.click('#modelExportForm button[value="preview"]');
    assert.match(await page.locator('#modelExportError').innerText(), /内容已变化/);
    await page.click('#modelExportCancel');
    await open('a.dita'); await source(initial);
    } catch (error) { console.error('Publication flow:', error); throw error; }
    finally { await page.locator('dialog[open]').evaluateAll(dialogs => dialogs.forEach(dialog => dialog.close())); await open('a.dita'); await source(initial); }
  });
  await t.test('MQTT delivery acceptance: GBK save, dependency buffers, three models and real HTML/MD downloads', async () => {
    const resourcePath = 'manual/shared/notes.dita';
    const resourceOriginal = await fs.readFile(path.join(root, resourcePath), 'utf8');
    try {
      await open('manual/topics/publish.dita');
      assert.match(await current(), /发布消息/);
      await source((await current()).replace('C_ONLY', 'C_EDITED'));
      await page.click('#saveButton');
      await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('manual/topics/publish.dita').dirty);
      const saved = require('iconv-lite').decode(await fs.readFile(gbkPath), 'gbk');
      assert.match(saved, /encoding="GBK"/); assert.match(saved, /发布消息/); assert.match(saved, /C_EDITED/);
      await open(resourcePath); await source(resourceOriginal.replace('AB_SHARED', 'AB_WORKING'));
      await open('manual/mqtt-acceptance.ditamap');
      for (const model of ['M100', 'M200', 'M300']) {
        await page.click('#exportMenuButton'); await page.click('#modelExportButton');
        await page.selectOption('#exportModel', model); await page.selectOption('#exportFormat', 'html');
        await page.click('#modelExportForm button[value="preview"]');
        const frame = page.frameLocator('#htmlPreviewFrame'); await frame.locator('.export-footnotes').waitFor();
        const text = await frame.locator('body').innerText();
        assert.equal(text.includes('A_CONREF'), model === 'M100');
        assert.equal(text.includes('AB_WORKING'), model !== 'M300');
        assert.equal(text.includes('C_EDITED'), model === 'M300');
        assert.match(text, /COMMON_CONREF/); assert.match(text, /UNMARKED/);
        assert.doesNotMatch(text, /UNUSED_RESOURCE_BODY|ANCESTOR_EXCLUDED/);
        assert.equal(await frame.locator('a[href="#sec-1-node-publish%2Fparameters"]').count(), 1);
        assert.equal(await frame.locator('#sec-1-node-publish\\%2Fparameters').count(), 1);
        assert.equal(await frame.locator('table').count(), 2);
        assert.equal(await frame.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
        await page.click('#closeHtmlPreviewButton');
        for (const format of ['html', 'md']) {
          await page.click('#exportMenuButton'); await page.click('#modelExportButton');
          await page.selectOption('#exportModel', model); await page.selectOption('#exportFormat', format);
          const downloadPromise = page.waitForEvent('download');
          await page.click('#modelExportForm button[value="download"]');
          const download = await downloadPromise;
          assert.equal(download.suggestedFilename(), 'mqtt-acceptance-' + model + '.' + format);
          const output = await fs.readFile(await download.path(), 'utf8');
          assert.equal(output.includes('AB_WORKING'), model !== 'M300');
          assert.equal(output.includes('C_EDITED'), model === 'M300');
          assert.match(output, /COMMON_CONREF/); assert.match(output, /data:image\/svg\+xml/);
          assert.doesNotMatch(output, /UNUSED_RESOURCE_BODY|ANCESTOR_EXCLUDED/);
        }
      }
      assert.equal(await fs.readFile(path.join(root, resourcePath), 'utf8'), resourceOriginal);
      assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('manual/shared/notes.dita').current.includes('AB_WORKING')), true);
    } finally {
      await page.locator('dialog[open]').evaluateAll(dialogs => dialogs.forEach(dialog => dialog.close()));
      if (await page.locator('#htmlPreviewPane.active').count()) await page.click('#closeHtmlPreviewButton');
      await open(resourcePath); await source(resourceOriginal);
      await open('a.dita'); await source(initial);
    }
  });
  await t.test('Git bulk rejection stays unsaved, undoable and keeps the Git baseline', async () => {
    const changed = initial.replace('Original', 'Saved change');
    await source(changed); await page.click('#saveButton');
    await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty);
    const before = writes.length;
    await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'git');
    await page.click('#rejectAllButton');
    assert.equal(await current(), initial);
    assert.equal(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), changed);
    assert.equal(writes.length, before);
    await undo(); assert.equal(await current(), changed);
    await page.click('#reviewButton'); await page.click('#acceptAllButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').baseline), initial);
    assert.equal(writes.length, before);
  });
  await t.test('Oxygen-only bulk actions work and restore the complete deletion', async () => {
    await open('oxy.dita'); await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen');
    assert.equal(await page.locator('#rejectAllButton').isEnabled(), true);
    const before = writes.length;
    await page.click('#rejectAllButton');
    assert.ok((await current()).includes(deleted)); assert.doesNotMatch(await current(), /oxy_insert|oxy_delete|Inserted/);
    assert.equal(writes.length, before); assert.equal(await fs.readFile(path.join(root, 'oxy.dita'), 'utf8'), oxygen);
    await undo(); assert.equal(await current(), oxygen);
    await page.click('#reviewButton'); await page.selectOption('#reviewScope', 'oxygen'); await page.click('#acceptAllButton');
    assert.match(await current(), /Inserted/); assert.doesNotMatch(await current(), /oxy_insert|oxy_delete|deleted content/);
    await undo(); assert.equal(await current(), oxygen);
  });
  await t.test('Map bulk rejection preserves files until explicit Save', async () => {
    await open('main.ditamap'); await page.click('#reviewButton');
    await page.waitForSelector('.map-topic-surface'); await page.selectOption('#reviewScope', 'git');
    const before = writes.length;
    await page.click('#rejectAllButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), initial);
    assert.match(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), /Saved change/);
    assert.equal(writes.length, before);
    await page.click('#saveButton');
    await page.waitForFunction(() => Array.from(window.DitaApp.state.filesMap.values()).every(file => !file.dirty));
    assert.equal(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), initial);
  });
  if (process.env.DITA_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.DITA_BROWSER_SCREENSHOT });
  await t.test('390px layout remains contained', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });
  assert.deepEqual(errors, []);
});
