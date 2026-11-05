'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process'), { chromium } = require('playwright-core'), iconv = require('iconv-lite');
test('contextual writing and model note details preserve source and editing context', { timeout: 90000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-numbers-')), repo = path.join(temp, 'docs'); await fs.mkdir(repo);
  const original = {
    'a.dita': '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="a"><title>第一章</title><body><p id="first">A_CMD<fn product="M100">A_INLINE</fn></p><fn id="shared" product="M100">SHARED_TEXT</fn><p>Ref<xref href="#a/shared" type="fn"/> Again<xref href="#a/shared" type="fn"/></p></body></topic>\r\n<?tail preserve?>',
    'b.dita': '<topic id="b"><title>第二章</title><body><p id="second">B_CMD<fn product="M100">B_INLINE</fn><fn conref="resource.dita#r/external"/></p><p><xref href="a.dita#a/shared" type="fn"/></p></body></topic>',
    'resource.dita': '<topic id="r"><title>公共定义</title><body><fn id="external">EXTERNAL_TEXT</fn></body></topic>',
    'tools.dita': '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="tools"><title>Tools</title><body><p id="plain" product="M100">PARAMETER_TEXT</p><p id="rich"><b id="bold" product="M100"><i><codeph>ABCD</codeph></i></b></p><p id="guard"><b id="guard-bold">BEFORE<fn>PROTECTED</fn>AFTER</b></p><p id="links"><xref id="l" href="a.dita#a" outputclass="retain" product="M100"><b id="lb">LINKTEXT</b></xref></p><table id="params"><tgroup cols="2"><tbody><row><entry id="cell">A</entry><entry>B</entry></row><row><entry>C</entry><entry>D</entry></row></tbody></tgroup></table><table id="merged"><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry namest="c1" nameend="c2">MERGED</entry></row></tbody></tgroup></table></body></topic>\r\n<?tail keep?>',
    'public.dita': '<topic id="public"><title>Public</title><body><fn id="n" product="M100 M200">NEVER_USED_PUBLIC</fn></body></topic>',
    'scope.dita': '<topic id="scope"><title>条件测试</title><body><p id="scope-paragraph" product="M100">受限正文<fn product="M100">INHERITED</fn></p></body></topic>',
    'c.dita': '<topic id="c"><title>另一手册</title><body><p>C<fn>C_INLINE</fn></p></body></topic>',
    'main.ditamap': '<map><title>功能手册</title><topicref href="a.dita"/><topicref href="b.dita"/><topicref href="tools.dita"/><topicref href="public.dita" processing-role="resource-only"/></map>',
    'other.ditamap': '<map><title>另一功能手册</title><topicref href="c.dita"/></map>'
  };
  for (const [name, source] of Object.entries(original)) await fs.writeFile(path.join(repo, name), iconv.encode(source, name === 'a.dita' ? 'gbk' : 'utf8'));
  await fs.writeFile(path.join(repo, '.dita-project.json'), JSON.stringify({ schema: 1, models: ['M100', 'M200'] }));
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temp, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; t.after(async () => { await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await fs.rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const errors = [];
  async function fresh(subtest) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); subtest.after(() => page.close());
    await page.goto('http://127.0.0.1:' + port); await page.waitForFunction(() => window.DitaApp?.state.root);
    await page.selectOption('#mapSelect', 'main.ditamap'); await page.click('.map-open-author'); await page.waitForSelector('.map-topic-surface');
    await page.evaluate(() => window.DitaApp.notePresentation.ready()); return page;
  }
  const marker = (page, text) => page.locator('#visualEditor [data-fn-text="' + text + '"]');
  const ready = page => page.evaluate(() => window.DitaApp.notePresentation.ready());

  async function select(page, selector, start, end = start, { summon = true } = {}) {
    await page.locator(selector).evaluate((node, positions) => {
      node.closest('[contenteditable=true]').focus({preventScroll:true});
      const range = document.createRange(); range.setStart(node.firstChild, positions.start); range.setEnd(node.firstChild, positions.end);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, { start, end });
    if (summon) { await page.keyboard.press('Alt+z'); await page.waitForSelector('#authorQuickTools:not([hidden])'); }
  }
  await t.test('clicks, text selections and arrow movement never summon the tools automatically', async subtest => {
    const page = await fresh(subtest);
    await page.locator('#first').click(); await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    await select(page, '#first', 0, 3, { summon: false }); await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    await page.keyboard.press('Alt+z'); assert.equal(await page.locator('#authorQuickTools').isVisible(), true);
    await page.keyboard.press('Alt+z'); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    assert.equal(await page.evaluate(() => [...window.DitaApp.state.filesMap.values()].some(f => f.dirty)), false);
  });
  await t.test('nearby formatting keeps the exact selection and supports undo without editing XML metadata', async subtest => {
    const page = await fresh(subtest);
    await select(page, '#first', 0, 3);
    assert.equal(await page.locator('#authorQuickTools [data-quick-format=b]').isVisible(), true);
    await page.click('#authorQuickTools [data-quick-format=b]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita'].replace('A_CMD', '<b>A_C</b>MD'));
    assert.equal(await page.evaluate(() => getSelection().toString()), 'A_C');
    await page.click('#authorUndoButton'); await ready(page);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita']);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('b.dita').dirty), false);
  });
  await t.test('caret actions open links, tables and footnotes with cancellation preserving source', async subtest => {
    const page = await fresh(subtest);
    await select(page, '#first', 2);
    assert.equal(await page.locator('#authorQuickTools [data-quick-format=b]').isVisible(), false);
    await page.click('#authorQuickTools [data-quick-insert=xref]'); await page.waitForSelector('#resourceDialog[open]'); await page.click('#resourceClose');
    await select(page, '#first', 2); await page.click('#authorQuickTools [data-quick-more]'); await page.click('#authorQuickTools [data-quick-insert=table]'); await page.waitForSelector('#tableInsertDialog[open]'); await page.click('#tableInsertCancel');
    await select(page, '#first', 2); await page.click('#authorQuickTools [data-quick-insert=fn]'); await page.waitForSelector('#newFootnoteDialog[open]'); await page.click('#newFootnoteCancel');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita']);
    await select(page, '#first', 2); await page.click('#authorQuickTools [data-quick-insert=fn]'); await page.fill('#newFootnoteContent', 'QUICK_NOTE'); await page.check('#newFootnoteModels input[value=M100]'); await page.click('#newFootnoteForm button[type=submit]'); await ready(page);
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), /A_<fn product="M100">QUICK_NOTE<\/fn>CMD/);
    await page.click('#authorUndoButton'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original['a.dita']);
  });
  await t.test('keyboard access, composition, protected selections and mode changes dismiss tools safely', async subtest => {
    const page = await fresh(subtest);
    await select(page, '#first', 0, 3);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '快捷加粗');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#authorQuickTools').isVisible(), false); assert.equal(await page.evaluate(() => getSelection().toString()), 'A_C');
    await select(page, '#first', 1);
    await page.locator('#first').dispatchEvent('compositionstart'); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    await page.locator('#first').dispatchEvent('compositionend');
    await page.locator('#first').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); node.dispatchEvent(new PointerEvent('pointerup', { bubbles:true })); });
    await page.keyboard.press('Alt+z'); assert.equal(await page.locator('#authorQuickTools').isVisible(), false, 'selection crossing protected fn has no tools');
    await select(page, '#first', 1); await page.evaluate(() => window.DitaApp.setMode('editor')); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
    assert.equal(await page.evaluate(() => [...window.DitaApp.state.filesMap.values()].some(f => f.dirty)), false);
  });
  await t.test('single click previews shared content, source and real usage count without dirtying documents', async subtest => {
    const page = await fresh(subtest);
    await page.locator('#visualEditor .fn-ref[data-dita-source=xref]').last().click(); await page.waitForSelector('#footnotePeek:not([hidden])');
    const text = await page.locator('#footnotePeekDetails').innerText(); assert.match(text, /SHARED_TEXT/); assert.match(text, /M100/); assert.match(text, /公共来源：a.dita/); assert.match(text, /当前手册内 3 处使用/); assert.match(text, /其他手册未统计/);
    await page.click('#footnotePeek .note-usage-list summary'); assert.equal(await page.locator('#footnotePeek .note-usage-list li').count(), 3);
    assert.equal(await page.evaluate(() => [...window.DitaApp.state.filesMap.values()].some(f => f.dirty)), false);
    await page.click('#footnotePeekEdit'); await page.waitForSelector('#footnoteEditDialog[open]'); assert.match(await page.locator('#footnoteEditDetails').innerText(), /3 处使用/);
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap', 'a mounted shared source edits in place'); await page.click('#footnoteCancel');
    await page.locator('.map-topic-surface[data-map-topic-path="b.dita"] [data-fn-number="4"]').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]'); assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'resource.dita'); await page.click('#footnoteCancel');
    assert.equal(await page.locator('#returnWritingPosition').isVisible(), true); await page.click('#returnWritingPosition'); await page.waitForSelector('.map-topic-surface[data-map-topic-path="b.dita"]');
    assert.equal(await page.evaluate(() => window.DitaApp.state.activePath), 'main.ditamap');
  });
  await t.test('model selection shows effective intersection and source restrictions live', async subtest => {
    const page = await fresh(subtest); await page.evaluate(() => window.DitaApp.openFile('scope.dita')); await ready(page);
    await marker(page, 'INHERITED').dblclick(); await page.waitForSelector('#footnoteEditDialog[open]');
    assert.equal(await page.locator('#footnoteCommon').isDisabled(), true);
    assert.match(await page.locator('#footnoteScopeSummary').innerText(), /当前清单中适用：M100/);
    await page.uncheck('#footnoteModels input[value=M100]'); await page.check('#footnoteModels input[value=M200]');
    assert.match(await page.locator('#footnoteScopeSummary').innerText(), /没有交集/);
    await page.check('#footnoteModels input[value=M100]'); assert.match(await page.locator('#footnoteScopeSummary').innerText(), /当前清单中适用：M100$/);
    await page.click('#footnoteCancel'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('scope.dita').dirty), false);
  });
  await t.test('mobile popovers fit the viewport and disappear on document switches', async subtest => {
    const page = await fresh(subtest); await page.setViewportSize({ width:390, height:760 });
    await page.evaluate(() => window.DitaApp.openFile('a.dita')); await ready(page);
    await select(page, '#first', 1);
    let bounds = await page.locator('#authorQuickTools').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await marker(page, 'A_INLINE').click(); await page.waitForSelector('#footnotePeek:not([hidden])');
    await page.click('#footnotePeek .note-usage-list summary');
    await page.waitForFunction(() => { const r = document.getElementById('footnotePeek').getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; });
    bounds = await page.locator('#footnotePeek').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 760);
    await page.evaluate(() => window.DitaApp.openFile('c.dita')); await ready(page); assert.equal(await page.locator('#footnotePeek').isVisible(), false); assert.equal(await page.locator('#authorQuickTools').isVisible(), false);
  });
  await t.test('Help opens a real shortcut dialog with focus, modal isolation and a compact layout', async subtest => {
    const page = await fresh(subtest); await page.click('#footnotesButton'); await page.waitForSelector('.footnote-card');
    const pending = original['a.dita'] + '<!--pending-->';
    await page.evaluate(source => { const a = window.DitaApp; a.setFileContent(a.state.filesMap.get('a.dita'), source); }, pending);
    await page.click('[data-menu=help]'); await page.locator('#menuPopup button').filter({ hasText: '快捷键' }).click();
    await page.waitForSelector('#shortcutHelpDialog[open]');
    assert.match(await page.locator('#shortcutHelpDialog').innerText(), /Alt \+ Z/);
    assert.equal(await page.locator('#menuPopup').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcutHelpClose');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), pending, 'modal help must not undo document edits');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.getElementById('shortcutHelpDialog').contains(document.activeElement)), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#shortcutHelpDialog').isVisible(), false); assert.equal(await page.locator('#footnotesPanel').isVisible(), true);
    await page.waitForFunction(() => document.activeElement.dataset.menu === 'help');
    await page.click('[data-menu=help]'); await page.locator('#menuPopup button').filter({ hasText: '快捷键' }).click();
    await page.setViewportSize({ width:390, height:760 });
    assert.equal(await page.locator('#shortcutHelpDialog').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    const bounds = await page.locator('#shortcutHelpClose').boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 760);
    await page.click('#shortcutHelpClose'); assert.equal(await page.locator('#shortcutHelpDialog').isVisible(), false);
  });

  async function toolsSelect(page, selector, start=0, end=start) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator(selector).evaluate((node,p)=>{
      node.closest('[contenteditable=true]').focus({preventScroll:true});
      function point(offset){const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(offset<=n.length)return[n,offset];offset-=n.length;}return[node,node.childNodes.length];}
      const r=document.createRange();r.setStart(...point(p.start));r.setEnd(...point(p.end));getSelection().removeAllRanges();getSelection().addRange(r);
    },{start,end});
    await page.keyboard.press('Alt+z');await page.waitForSelector('#authorQuickTools:not([hidden])');
  }
  async function quick(page, selector){const b=page.locator('#authorQuickTools '+selector);if(!await b.isVisible())await page.click('#authorQuickTools [data-quick-more]');await b.click();}
  const toolsCurrent=page=>page.evaluate(()=>window.DitaApp.state.filesMap.get('tools.dita').current);
  const toolsUndo=async page=>{await page.click('#authorUndoButton');assert.equal(await toolsCurrent(page),original['tools.dita']);};
  await t.test('paragraph insertion and conversions preserve the active Topic, models and exact undo',async st=>{
    const page=await fresh(st);await toolsSelect(page,'#plain',2);await quick(page,'[data-quick-insert=p]');assert.match(await toolsCurrent(page),/<p id="plain" product="M100">PARAMETER_TEXT<\/p><p>在此输入内容<\/p>/);await toolsUndo(page);
    for(const type of ['ul','ol','note','codeblock']){await toolsSelect(page,'#plain',2);await quick(page,'[data-quick-convert='+type+']');assert.match(await toolsCurrent(page),new RegExp(['ul','ol'].includes(type) ? '<'+type+'><li id="plain" product="M100">' : '<'+type+' id="plain" product="M100">'));await toolsUndo(page);}
    assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').dirty),false);
  });
  await t.test('cell tools insert rows/columns, toggle headers and reject merged tables',async st=>{
    const page=await fresh(st);for(const action of ['row-after','col-after','header']){await toolsSelect(page,'#params tr:first-child td:first-child');await quick(page,'[data-quick-action='+action+']');assert.notEqual(await toolsCurrent(page),original['tools.dita']);assert.equal(await page.evaluate(()=>getSelection().anchorNode?.parentElement.closest('.map-topic-surface')?.dataset.mapTopicPath),'tools.dita');if(action==='header')assert.match(await toolsCurrent(page),/<thead><row><entry id="cell">A<\/entry>/);await toolsUndo(page);}
    await toolsSelect(page,'#merged td');assert.equal(await page.locator('#authorQuickTools [data-quick-action=row-after]').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await toolsCurrent(page),original['tools.dita']);
  });
  await t.test('partial format clearing retains IDs, model conditions and unselected protected content',async st=>{
    const page=await fresh(st);await toolsSelect(page,'#rich',1,3);await quick(page,'[data-quick-action=clear]');assert.equal(await page.evaluate(()=>getSelection().toString()),'BC');assert.equal(await page.locator('#bold').getAttribute('product'),'M100');assert.equal(await page.locator('#bold').getAttribute('data-dita-source'),'ph');
    const text=await page.locator('#rich').evaluate(node=>{const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),out=[];let n;while((n=w.nextNode()))out.push([n.data,!!n.parentElement.closest('[data-dita-source=b],[data-dita-source=i],[data-dita-source=codeph]')]);return out;});assert.ok(text.some(([s,f])=>s==='BC'&&!f));assert.ok(text.some(([s,f])=>s==='A'&&f));assert.ok(text.some(([s,f])=>s==='D'&&f));await toolsUndo(page);
    await toolsSelect(page,'#guard',0,3);await quick(page,'[data-quick-action=clear]');assert.match(await toolsCurrent(page),/<b><fn>PROTECTED<\/fn><\/b>/);await toolsUndo(page);
  });
  await t.test('link edit and unlink keep rich children, anchors, conditions and undo',async st=>{
    const page=await fresh(st);await toolsSelect(page,'#lb',1,4);await quick(page,'[data-quick-action=clear]');assert.equal(await page.locator('#l').getAttribute('href'),'a.dita#a');assert.equal(await page.locator('#l').getAttribute('product'),'M100');assert.equal(await page.locator('#lb').getAttribute('data-dita-source'),'ph');await toolsUndo(page);await toolsSelect(page,'#lb',1,4);assert.equal(await page.locator('#authorQuickTools [data-quick-insert=xref]').isVisible(),false);await quick(page,'[data-quick-action=edit-link]');await page.waitForSelector('#resourceDialog[open]');await page.fill('#resourceHref','b.dita#b');await page.click('#resourceForm button[type=submit]');assert.match(await toolsCurrent(page),/href="b.dita#b"/);await toolsUndo(page);
    await toolsSelect(page,'#lb',1,4);await quick(page,'[data-quick-action=unlink]');assert.match(await toolsCurrent(page),/<ph id="l" outputclass="retain" product="M100"><b id="lb">LINKTEXT<\/b><\/ph>/);await toolsUndo(page);
  });
  await t.test('unused public resource definitions can be referenced with the intersection of model conditions',async st=>{
    const page=await fresh(st);await toolsSelect(page,'#plain',2,5);await quick(page,'[data-quick-action=reuse]');await page.waitForSelector('#reuseNoteSubmit:not(:disabled)');await page.fill('#reuseNoteFilter','NEVER_USED_PUBLIC');await page.selectOption('#reuseNoteTarget',{label:'NEVER_USED_PUBLIC · public.dita'});assert.match(await page.locator('#reuseNotePreview').innerText(),/此处适用：M100/);await page.click('#reuseNoteSubmit');await page.waitForFunction(()=>!document.getElementById('reuseNoteDialog').open);await ready(page);
    assert.match(await toolsCurrent(page),/PARAM<xref type="fn" href="public.dita#public\/n"\/>ETER_TEXT/);assert.equal(await page.locator('#plain .fn-ref').innerText(),'[5]');assert.equal(await fs.readFile(path.join(repo,'public.dita'),'utf8'),original['public.dita']);await toolsUndo(page);
  });
  await t.test('reuse filtering, cancellation and stale source changes preserve current buffers',async st=>{
    const page=await fresh(st);await toolsSelect(page,'#plain',2);await quick(page,'[data-quick-action=reuse]');await page.waitForSelector('#reuseNoteSubmit:not(:disabled)');await page.fill('#reuseNoteFilter','no-match');assert.equal(await page.locator('#reuseNoteSubmit').isDisabled(),true);await page.click('#reuseNoteCancel');assert.equal(await toolsCurrent(page),original['tools.dita']);
    await toolsSelect(page,'#plain',2);await quick(page,'[data-quick-action=reuse]');await page.waitForSelector('#reuseNoteSubmit:not(:disabled)');await page.evaluate(()=>{const a=window.DitaApp,f=a.state.filesMap.get('a.dita');a.setFileContent(f,f.current.replace('SHARED_TEXT','NEWER_PUBLIC'));});await page.click('#reuseNoteSubmit');assert.match(await page.locator('#reuseNoteError').innerText(),/已变化/);assert.equal(await toolsCurrent(page),original['tools.dita']);await page.click('#reuseNoteCancel');
  });
  await t.test('More keeps keyboard selection and all expanded controls within a narrow viewport',async st=>{
    const page=await fresh(st);await page.setViewportSize({width:390,height:760});await toolsSelect(page,'#rich',1,3);await page.click('#authorQuickTools [data-quick-more]');const r=await page.locator('#authorQuickTools').boundingBox();assert.ok(r.x>=0&&r.x+r.width<=390&&r.y>=0&&r.y+r.height<=760);await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.quickInsert),'image');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>getSelection().toString()),'BC');assert.equal(await toolsCurrent(page),original['tools.dita']);
  });
  assert.deepEqual(errors, []);
});
