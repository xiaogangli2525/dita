'use strict';
const ui = require('./browser-ui');
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
  const reviewSource = [
    '<topic id="review"><title>Review</title><body>',
    '<p id="first">Same wording</p>',
    '<p id="second">Same wording</p>',
    '<p>Unchanged between edits</p>',
    '<p>Remove this block</p>',
    '<p id="next">Following paragraph</p>',
    '<table><tgroup cols="1"><tbody><row><entry>Old parameter</entry></row></tbody></tgroup></table>',
    '</body></topic>'
  ].join('\n');
  const inlineSource = [
    '<topic id="inline"><title>行内审阅</title><body>',
    '<p id="sentence">超时为 <b>30</b> 秒，成功后返回 <codeph>OK</codeph>。旧说明。</p>',
    '<p id="duplicate">旧说明。</p>',
    '<p id="escaped">A &amp; B &#x1F642; &lt;port&gt;</p>',
    '<p>保留段落一</p>', '<p>保留段落二</p>', '<p>保留段落三</p>',
    '<codeblock id="code"><![CDATA[AT+OLD\n    wait(30);]]></codeblock>',
    '<p>代码与表格之间</p>',
    '<table><tgroup cols="2"><tbody>',
    '<row id="deleted-row"><entry>重复参数</entry><entry>删除这一行</entry></row>',
    '<row id="kept-row"><entry>重复参数</entry><entry>保留这一行</entry></row>',
    '</tbody></tgroup></table>',
    '<p id="tail">保留末段</p>',
    '</body></topic>'
  ].join('\n');
  const deleted = '<p>' + 'deleted content '.repeat(40) + '</p>';
  const oxygen = '<topic id="oxy"><title>Oxygen</title><body><p><?oxy_insert_start author="A"?>Inserted<?oxy_insert_end?></p><?oxy_delete author="A" content="' + deleted.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"?></body></topic>';
  await fs.writeFile(path.join(root, 'a.dita'), initial);
  await fs.writeFile(path.join(root, 'review.dita'), reviewSource);
  await fs.writeFile(path.join(root, 'inline.dita'), inlineSource);
  const persistentSource = '<topic id="persist"><title>审阅进度</title><body>\n<p id="one">First original</p>\n<p>Unchanged</p>\n<p id="two">Second original</p>\n</body></topic>';
  await fs.writeFile(path.join(root, 'persist-topic.dita'), persistentSource);
  await fs.writeFile(path.join(root, 'persist-map.ditamap'), '<map><title>Persist manual</title><topicref href="persist-topic.dita"/></map>');
  const unifiedSource = '<topic id="unified"><title>统一审阅</title><body>\n<p id="unified-phrase">参数为 <b>30</b> 秒。</p>\n<p>保留中间段落</p>\n<table><tgroup cols="1"><tbody><row><entry id="unified-cell">原始值</entry></row></tbody></tgroup></table>\n</body></topic>';
  await fs.writeFile(path.join(root, 'unified-topic.dita'), unifiedSource);
  await fs.writeFile(path.join(root, 'unified-manual.ditamap'), '<map><title>统一审阅手册</title><topicref href="unified-topic.dita"/></map>');
  await fs.writeFile(path.join(root, 'oxy.dita'), oxygen);
  await fs.writeFile(path.join(root, 'oxy-second.dita'), oxygen);
  await fs.writeFile(path.join(root, 'oxy-pair-manual.ditamap'), '<map><title>Oxygen 来源定位</title><topicref href="oxy.dita"/><topicref href="oxy-second.dita"/></map>');
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
  const effectiveTexts = locator => locator.evaluateAll(nodes => nodes.map(node => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('[data-review-text="old"],[data-review-ghost]').forEach(deletion => deletion.remove());
    return clone.textContent;
  }));
  const showSource = async () => { if (!await page.locator('#sourceButton').isVisible()) await page.click('.editing-tools summary'); await page.click('#sourceButton'); if (await page.locator('.editing-tools[open]').count()) await page.click('.editing-tools summary'); };
  const source = async text => { await showSource(); await page.fill('#editor', text); };
  const undo = async () => { await showSource(); await page.focus('#editor'); await page.keyboard.press('Control+z'); };

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
    await page.click('#inspectorToggleButton');
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
    await source(notes); await ui.openNotes(page);
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
    await open('main.ditamap'); await ui.openNotes(page);
    await page.waitForFunction(() => document.getElementById('footnoteCount').textContent === '3');
    await page.selectOption('#footnoteModel', '');
    await page.locator('.footnote-actions').getByRole('button', { name: '定位正文', exact: true }).first().click();
    await page.waitForFunction(() => window.DitaApp.state.activePath === 'main.ditamap');
    assert.equal(await page.locator('#footnoteScope').innerText(), 'main.ditamap');
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), /Changed elsewhere/);
    assert.match(await page.locator('.footnote-located').innerText(), /AT\+MQTTOPEN/);
    await page.locator('.footnote-edit-button').last().click();
    assert.match(await page.locator('#footnoteContentLabel').innerText(), /XML/);
    assert.match(await page.locator('#footnoteContent').inputValue(), /<xref href="a.dita">link<\/xref>/);
    await page.fill('#footnoteProducts', 'M200 M300'); await page.click('#footnoteEditForm button[type="submit"]');
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), /product="M200 M300"/); assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), /<xref href="a.dita">link<\/xref>/);
    await open('main.ditamap'); await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor(); await page.selectOption('#exportModel', ''); await page.selectOption('#exportFormat', 'html'); await page.click('#modelExportForm button[value="preview"]');
    await page.waitForFunction(() => document.getElementById('htmlPreviewFrame').src.startsWith('blob:'));
    const frame = page.frameLocator('#htmlPreviewFrame');
    await frame.locator('.export-footnotes').waitFor();
    assert.match(await frame.locator('.export-footnotes').innerText(), /Revised & exact/);
    assert.match(await frame.locator('.export-footnotes').innerText(), /Changed elsewhere/);
    await page.click('#closeHtmlPreviewButton');
    await ui.openProperties(page); await open('a.dita'); await source(initial);
  });
  await t.test('model HTML preview and MD download use one scope, valid references and unchanged sources', async () => {
    try {
    const publication = '<topic id="a"><title>Publication</title><body><p>Body<fn product="M100">A ONLY</fn><fn product="M200">B ONLY</fn><fn>UNKNOWN NOTE</fn></p><fn id="n" product="M100">SHARED NOTE</fn><p>One<xref href="#a/n" type="fn"/> Two<xref href="#a/n" type="fn"/></p></body></topic>';
    await open('a.dita'); await source(publication); await open('main.ditamap');
    await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
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
    await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
    await page.selectOption('#exportModel', 'M100'); await page.selectOption('#exportFormat', 'md');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#modelExportForm button[value="download"]');
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'main-M100.md');
    const md = await fs.readFile(await download.path(), 'utf8');
    assert.match(md, /A ONLY/); assert.match(md, /UNKNOWN NOTE/); assert.doesNotMatch(md, /B ONLY/);
    assert.match(md, /One\[\^3\] Two\[\^3\]/);
    // A buffered edit after the dialog has captured its snapshot must invalidate it.
    await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
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
        await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
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
          await page.click('#exportMenuButton'); await page.locator('#exportModel:not(:disabled)').waitFor();
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
  await t.test('review marks source-aligned paragraphs, table cells and deletion locations', async () => {
    await open('review.dita');
    try {
      await page.click('#reviewButton');
      assert.match(await page.locator('#diff').innerText(), /当前 Topic 没有待审阅/);
      const revised = reviewSource
        .replace('id="second">Same wording', 'id="second">Revised wording')
        .replace('<p>Remove this block</p>\n', '')
        .replace('Old parameter', 'New parameter');
      await source(revised);
      await page.click('[data-menu=dita]');
      await page.getByRole('menuitem', { name: '审阅变更' }).click();
      const changed = page.locator('#visualEditor [data-review-change]');
      const next = page.locator('#visualEditor #next');
      assert.deepEqual(await effectiveTexts(changed), ['Revised wording', 'New parameter']);
      assert.deepEqual(await page.locator('#visualEditor [data-review-ghost]').allTextContents(), ['Remove this block']);
      assert.equal(await page.locator('#visualEditor [data-review-ghost]').evaluate(node => node.nextElementSibling.id), 'next');
      assert.equal(await next.getAttribute('data-review-deletion'), 'before');
      assert.equal(await page.locator('#visualEditor #first').getAttribute('data-review-change'), null);
      const parameter = page.locator('#diff .diff-block').filter({ hasText: 'parameter' });
      await parameter.locator('.diff-block-header').click();
      assert.equal(await page.locator('#visualEditor td.review-target-focus').count(), 1);
      await parameter.getByRole('button', { name: '拒绝此块' }).click();
      assert.deepEqual(await effectiveTexts(changed), ['Revised wording']);
      assert.equal(await current(), revised.replace('New parameter', 'Old parameter'));
      await parameter.getByRole('button', { name: '撤销决定' }).click();
      const deletion = page.locator('#diff .diff-block').filter({ hasText: 'Remove this block' });
      await deletion.getByRole('button', { name: '拒绝此块' }).click();
      assert.equal(await next.getAttribute('data-review-deletion'), null);
      assert.deepEqual(await effectiveTexts(changed), ['Revised wording', 'New parameter']);
      assert.equal(await page.locator('#visualEditor [data-review-ghost]').count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      const body = await page.locator('#visualPane').boundingBox();
      const panel = await page.locator('#inspector').boundingBox();
      assert.ok(body.y + body.height <= panel.y + 1, 'the diff panel should leave the document visible');
      await page.click('#inspectorCloseButton');
      assert.equal(await changed.count(), 0);
    } finally {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await source(reviewSource);
    }
  });
  await t.test('inline review retains deleted words, entities, code and rows until an explicit decision', async () => {
    await open('inline.dita');
    const revised = inlineSource.replace('<b>30</b>', '<b>60</b>').replace('。旧说明。</p>', '。新增 &lt;img src=x onerror=alert(1)&gt;。</p>')
      .replace('&amp; B &#x1F642;', '&amp; C &#x1F600;').replace('AT+OLD', 'AT+NEW').replace('wait(30)', 'wait(60)')
      .replace('<row id="deleted-row"><entry>重复参数</entry><entry>删除这一行</entry></row>\n', '');
    await source(revised); await page.click('#reviewButton');
    const oldText = '#visualEditor [data-review-text="old"]', newText = '#visualEditor [data-review-text="new"]';
    assert.equal(await page.locator('#sentence [data-dita-source="b"] [data-review-text="old"]').textContent(), '3');
    assert.equal(await page.locator('#sentence [data-dita-source="b"] [data-review-text="new"]').textContent(), '6');
    assert.match(await page.locator('#sentence').innerText(), /旧说明/);
    assert.equal(await page.locator('#duplicate [data-review-text]').count(), 0);
    assert.equal(await page.locator('#visualEditor img').count(), 0, 'deleted and added model text must remain inert text');
    assert.deepEqual(await effectiveTexts(page.locator('#sentence')), ['超时为 60 秒，成功后返回 OK。新增 <img src=x onerror=alert(1)>。']);
    assert.deepEqual(await effectiveTexts(page.locator('#escaped')), ['A & C 😀 <port>']);
    assert.deepEqual(await effectiveTexts(page.locator('#code')), ['AT+NEW\n    wait(60);']);
    assert.equal(await page.locator('#visualEditor tbody > tr[data-review-ghost]').count(), 1);
    assert.equal(await page.locator('#visualEditor #deleted-row').count(), 0, 'deleted projections must not duplicate source IDs');
    const keptRow = page.locator('tr[data-dita-row-attrs*="kept-row"]');
    assert.equal(await keptRow.count(), 1);
    assert.equal(await keptRow.locator('[data-review-text]').count(), 0, 'repeated cells must stay anchored to their own source');
    assert.equal(await current(), revised);
    for (const skin of ['forest', 'blue', 'paper', 'dark']) {
      await page.evaluate(skin => window.DitaTheme.set(skin), skin);
      const oldStyle = await page.locator(oldText).first().evaluate(node => ({ decoration: getComputedStyle(node).textDecorationLine, color: getComputedStyle(node).color }));
      const newStyle = await page.locator(newText).first().evaluate(node => ({ decoration: getComputedStyle(node).textDecorationLine, color: getComputedStyle(node).color }));
      assert.match(oldStyle.decoration, /line-through/); assert.match(newStyle.decoration, /underline/); assert.notEqual(oldStyle.color, newStyle.color);
    }
    await page.evaluate(() => window.DitaTheme.set('forest'));
    if (process.env.DITA_REVIEW_SCREENSHOT) await page.screenshot({ path: process.env.DITA_REVIEW_SCREENSHOT });
    const pending = await page.locator('[data-review-text]').count();
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('inline.dita').dirty);
    assert.equal(await fs.readFile(path.join(root, 'inline.dita'), 'utf8'), revised);
    assert.equal(await page.locator('[data-review-text]').count(), pending, 'saving is not accepting a review');
    await page.evaluate(() => window.DitaApp.openModelExport({ scope: 'inline.dita' }));
    await page.locator('#exportModel:not(:disabled)').waitFor();
    await page.selectOption('#exportModel', ''); await page.selectOption('#exportFormat', 'html');
    await page.click('#modelExportForm button[value="preview"]');
    const exported = page.frameLocator('#htmlPreviewFrame');
    await exported.locator('body').waitFor();
    assert.match(await exported.locator('body').innerText(), /超时为 60 秒/);
    assert.doesNotMatch(await exported.locator('body').innerText(), /删除这一行|AT\+OLD/);
    assert.equal(await exported.locator('[data-review-text],[data-review-ghost],[data-review-decoration]').count(), 0);
    await page.click('#closeHtmlPreviewButton'); await page.click('#reviewButton');
    assert.equal(await page.locator('[data-review-text]').count(), pending, 'delivery preview must not accept pending changes');
    const sentenceChange = page.locator('#diff .diff-block').filter({ hasText: 'id="sentence"' });
    await sentenceChange.getByRole('button', { name: '接受此块' }).click();
    assert.equal(await page.locator('#sentence [data-review-text]').count(), 0);
    assert.deepEqual(await effectiveTexts(page.locator('#sentence')), ['超时为 60 秒，成功后返回 OK。新增 <img src=x onerror=alert(1)>。']);
    assert.ok(await page.locator('#code [data-review-text]').count() > 0);
    await page.click('#visualButton'); await page.click('#reviewButton');
    assert.equal(await page.locator('#sentence [data-review-text]').count(), 0, 'accepted decisions survive a mode switch');
    await sentenceChange.getByRole('button', { name: '撤销决定' }).click();
    assert.ok(await page.locator('#sentence [data-review-text="old"]').count() > 0);
    await sentenceChange.getByRole('button', { name: '拒绝此块' }).click();
    assert.equal(await page.locator('#sentence [data-review-text]').count(), 0);
    assert.equal(await page.locator('#sentence').textContent(), '超时为 30 秒，成功后返回 OK。旧说明。');
    await sentenceChange.getByRole('button', { name: '撤销决定' }).click();
    await page.click('#visualButton');
    assert.equal(await page.locator('[data-review-decoration],[data-review-ghost]').count(), 0);
    await page.locator('#tail').click(); await page.keyboard.press('End'); await page.keyboard.insertText('继续编写');
    assert.equal(await current(), revised.replace('保留末段', '保留末段继续编写'));
    await source(inlineSource);
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('inline.dita').dirty);
  });
  await t.test('review handles empty paragraphs, pure insertions and XML representation changes', async () => {
    await open('inline.dita');
    const empty = inlineSource.replace('<p id="duplicate">旧说明。</p>', '<p id="duplicate"/>');
    await source(empty); await page.click('#reviewButton');
    assert.equal(await page.locator('#duplicate [data-review-text="old"]').textContent(), '旧说明。');
    assert.equal(await page.locator('#escaped [data-review-text]').count(), 0, 'an empty paragraph deletion must not move into the next paragraph');
    assert.deepEqual(await effectiveTexts(page.locator('#duplicate')), ['']);
    const inserted = inlineSource.replace('<p id="tail">', '<p id="new-paragraph">新增整段内容</p>\n<p id="tail">');
    await source(inserted); await page.click('#reviewButton');
    assert.equal(await page.locator('#new-paragraph [data-review-text="new"]').textContent(), '新增整段内容');
    assert.equal(await page.locator('#visualEditor [data-review-text="old"]').count(), 0);
    const emptyTable = inlineSource.replace(/<row id="(?:deleted|kept)-row">.*?<\/row>\n/g, '');
    await source(emptyTable); await page.click('#reviewButton');
    assert.equal(await page.locator('#visualEditor tbody > tr[data-review-ghost]').count(), 2, 'deleted rows stay inside the table even when all original rows were removed');
    assert.doesNotMatch(await current(), /data-review/);
    const representation = inlineSource.replace('&amp;', '&#38;').replace('<b>30</b>', '<i>30</i>');
    await source(representation); await page.click('#reviewButton');
    assert.equal(await page.locator('#visualEditor [data-review-text]').count(), 0, 'formatting and equivalent entity changes must not invent deleted or added wording');
    const crlf = inlineSource.replace(/\n/g, '\r\n').replace('AT+OLD', 'AT+NEW').replace('wait(30)', 'wait(60)');
    await showSource();
    await page.evaluate(crlf => window.DitaApp.setFileContent(window.DitaApp.state.filesMap.get('inline.dita'), crlf), crlf);
    await page.click('#reviewButton');
    assert.deepEqual(await page.locator('#code [data-review-text="old"]').allTextContents(), ['OLD', '3']);
    assert.deepEqual(await effectiveTexts(page.locator('#code')), ['AT+NEW\n    wait(60);']);
    assert.equal(await current(), crlf);
    await source(inlineSource);
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('inline.dita').dirty);
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
    await open('a.dita'); await source(initial.replace('Original', 'Map pending change'));
    await page.click('#saveButton'); await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('a.dita').dirty);
    await open('main.ditamap'); await page.click('#reviewButton');
    await page.waitForSelector('.map-topic-surface'); await page.selectOption('#reviewScope', 'git');
    assert.deepEqual(await effectiveTexts(page.locator('.map-topic-surface[data-map-topic-path="a.dita"] [data-review-change]')), ['Map pending change']);
    const before = writes.length;
    await page.click('#rejectAllButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), initial);
    assert.match(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), /Map pending change/);
    assert.equal(writes.length, before);
    await page.click('#saveButton'); await page.click('#saveScopeConfirm');
    await page.waitForFunction(() => Array.from(window.DitaApp.state.filesMap.values()).every(file => !file.dirty));
    assert.equal(await fs.readFile(path.join(root, 'a.dita'), 'utf8'), initial);
  });
  await t.test('saved review progress survives reload and Topic/Map transitions while further edits require review', async () => {
    await open('persist-topic.dita');
    const revised = persistentSource.replace('First original', 'First revised').replace('Second original', 'Second revised');
    await source(revised); await page.click('#saveButton');
    await page.waitForFunction(() => !window.DitaApp.state.filesMap.get('persist-topic.dita').dirty);
    await page.click('#reviewButton');
    const first = () => page.locator('#diff .diff-block').filter({ hasText: 'id="one"' });
    await first().getByRole('button', { name: '接受此块' }).click();
    assert.equal(await page.locator('#one [data-review-text]').count(), 0);
    assert.ok(await page.locator('#two [data-review-text]').count());
    await page.reload(); await page.waitForFunction(() => window.DitaApp?.state.root);
    await open('persist-topic.dita'); await page.click('#reviewButton');
    assert.equal(await page.locator('#one [data-review-text]').count(), 0);
    assert.ok(await page.locator('#two [data-review-text]').count());
    await open('persist-map.ditamap'); await page.click('#reviewButton');
    await page.locator('.map-topic-surface #one').waitFor();
    assert.equal(await page.locator('#one [data-review-text]').count(), 0);
    assert.ok(await page.locator('#two [data-review-text]').count());
    await first().getByRole('button', { name: '撤销决定' }).click();
    assert.ok(await page.locator('#one [data-review-text]').count());
    await first().getByRole('button', { name: '接受此块' }).click();
    await open('persist-topic.dita'); await page.click('#reviewButton');
    assert.equal(await page.locator('#one [data-review-text]').count(), 0);
    await source(revised.replace('Second revised', 'Second revised again')); await page.click('#reviewButton');
    assert.equal(await page.locator('#one [data-review-text]').count(), 0);
    assert.ok(await page.locator('#two [data-review-text]').count());
    await source(revised.replace('First revised', 'First revised again')); await page.click('#reviewButton');
    assert.ok(await page.locator('#one [data-review-text]').count());
  });
  for (const scope of ['topic', 'manual']) await t.test(scope + ' review shares block decisions, reset and bulk undo without applying stale controls', async () => {
    await open('unified-topic.dita');
    const revised = unifiedSource.replace('30', '60').replace('原始值', '新值');
    await source(revised);
    if (scope === 'manual') await open('unified-manual.ditamap');
    await page.click('#reviewButton');
    const blocks = () => page.locator('#diff .diff-block');
    const phrase = () => blocks().filter({ hasText: 'id="unified-phrase"' });
    const text = () => page.evaluate(() => window.DitaApp.state.filesMap.get('unified-topic.dita').current);
    const ready = () => page.waitForFunction(() => {
      const app = window.DitaApp;
      const surface = app.state.activePath === 'unified-topic.dita' ? document.getElementById('visualEditor') :
        document.querySelector('.map-topic-surface[data-map-topic-path="unified-topic.dita"]');
      return surface?.ditaSourceContent === app.state.filesMap.get('unified-topic.dita').current;
    });
    await ready();
    assert.equal(await blocks().count(), 2);
    const stale = await phrase().getByRole('button', { name: '拒绝此块' }).elementHandle();
    const newer = revised.replace('60', '90');
    await page.evaluate(value => { const a = window.DitaApp; a.setFileContent(a.state.filesMap.get('unified-topic.dita'), value); }, newer);
    await stale.evaluate(button => button.click());
    await ready();
    assert.equal(await text(), newer, 'an outdated control cannot change newer source');
    await stale.dispose();
    await page.evaluate(value => { const a = window.DitaApp; a.setFileContent(a.state.filesMap.get('unified-topic.dita'), value); a.setMode('review'); }, revised);
    await ready();
    await phrase().getByRole('button', { name: '拒绝此块' }).click();
    await ready();
    assert.equal(await text(), revised.replace('60', '30'));
    assert.equal(await page.locator('#unified-phrase [data-review-text]').count(), 0);
    assert.ok(await page.locator('#visualEditor td [data-review-text]').count());
    await undo(); await page.click('#reviewButton');
    await ready();
    assert.equal(await text(), revised);
    await showSource(); await page.focus('#editor'); await page.keyboard.press('Control+y'); await page.click('#reviewButton');
    await ready();
    assert.equal(await text(), revised.replace('60', '30'));
    await phrase().getByRole('button', { name: '撤销决定' }).click();
    await ready();
    assert.equal(await text(), revised);
    assert.ok(await page.locator('#unified-phrase [data-review-text]').count());
    await phrase().getByRole('button', { name: '接受此块' }).click();
    await ready();
    assert.equal(await page.locator('#unified-phrase [data-review-text]').count(), 0);
    await page.click('#rejectAllButton');
    await ready();
    assert.equal(await text(), unifiedSource);
    await undo(); await page.click('#reviewButton');
    await ready();
    assert.equal(await text(), revised);
    assert.equal(await page.locator('#unified-phrase [data-review-text]').count(), 0);
    assert.ok(await page.locator('#visualEditor td [data-review-text]').count());
    await page.click('#acceptAllButton');
    await ready();
    assert.equal(await text(), revised);
    assert.equal(await page.locator('#visualEditor [data-review-text]').count(), 0);
    assert.equal(await fs.readFile(path.join(root, 'unified-topic.dita'), 'utf8'), unifiedSource);
    await open('unified-topic.dita'); await source(unifiedSource); await page.click('#reviewButton');
  });
  await t.test('Map Oxygen changes locate their source Topic when local revision indexes repeat', async () => {
    await open('oxy-pair-manual.ditamap'); await page.click('#reviewButton');
    await page.locator('.map-topic-surface[data-map-topic-path="oxy-second.dita"] [data-oxy-index="0"]').waitFor();
    const second = page.locator('#diff .map-review-topic').filter({ hasText: 'oxy-second.dita' });
    await second.locator('.oxy-change').first().click();
    assert.equal(await page.locator('.map-topic-surface[data-map-topic-path="oxy-second.dita"] .oxy-flash').count(), 1);
    assert.equal(await page.locator('.map-topic-surface[data-map-topic-path="oxy.dita"] .oxy-flash').count(), 0);
    await second.locator('.oxy-change').first().getByRole('button', { name: '接受', exact: true }).click();
    const sources = await page.evaluate(() => ['oxy.dita', 'oxy-second.dita'].map(path => window.DitaApp.state.filesMap.get(path).current));
    assert.equal(sources[0], oxygen);
    assert.doesNotMatch(sources[1], /oxy_insert/);
    assert.equal(await fs.readFile(path.join(root, 'oxy-second.dita'), 'utf8'), oxygen);
    await undo(); await page.click('#reviewButton');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('oxy-second.dita').current), oxygen);
  });
  await t.test('unrelated Topic delivery defaults to the Topic and offers an explicit manual choice', async () => {
    await page.click('[data-view="map"]');
    await page.selectOption('#mapSelect', 'main.ditamap');
    await open('inline.dita'); await page.click('#exportMenuButton');
    await page.locator('#exportModel:not(:disabled)').waitFor();
    assert.equal(await page.locator('#exportScope').inputValue(), 'inline.dita');
    assert.match(await page.locator('#modelExportScope').textContent(), /inline.dita/);
    await page.selectOption('#exportScope', 'main.ditamap');
    await page.waitForFunction(() => !document.getElementById('exportModel').disabled && document.getElementById('modelExportScope').textContent.includes('main.ditamap'));
    assert.equal(await page.locator('#exportScope').inputValue(), 'main.ditamap');
    await page.click('#modelExportCancel');
    await open('a.dita'); await page.click('#exportMenuButton');
    await page.locator('#exportModel:not(:disabled)').waitFor();
    assert.equal(await page.locator('#exportScope').inputValue(), 'main.ditamap');
    await page.click('#modelExportCancel');
  });
  if (process.env.DITA_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.DITA_BROWSER_SCREENSHOT });
  await t.test('390px layout remains contained', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });
  assert.deepEqual(errors, []);
});
