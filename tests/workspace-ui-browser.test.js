'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright-core');
test('workspace UI keeps keyboard focus, pending choices and long-dialog controls reliable',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dita-workspace-ui-')),repo=path.join(temp,'docs');await fs.mkdir(repo);
 const source='<topic id="a"><title>Alpha</title><prolog><metadata><data><title>Hidden metadata title</title></data></metadata></prolog><body><section><title>First section</title><p>Command<fn>通用说明。M100：ONE。M300：TWO。</fn></p></section><section><title>Second section</title><p>Tail<fn>第二条注脚。</fn></p></section></body></topic>';
 for(const[p,s]of Object.entries({'a.dita':source,'b.dita':'<topic id="b"><title>Beta</title><body><p>Second document</p></body></topic>','main.ditamap':'<map><title>Manual</title><topicref href="a.dita"/><topicref href="b.dita"/></map>','.dita-project.json':'{"schema":1,"models":["M100","M300"]}'}))await fs.writeFile(path.join(repo,p),s);
 for(const args of [['init'],['add','.'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture'],['branch','feature']])execFileSync('git',args,{cwd:repo,stdio:'ignore'});
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,DOCS_ROOT:repo,REPOSITORIES_ROOT:temp,PORT:String(port)},stdio:['ignore','pipe','pipe']});let browser;
 t.after(async()=>{await browser?.close();if(server.exitCode==null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await fs.rm(temp,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.DITA_CHROMIUM_EXECUTABLE?{executablePath:process.env.DITA_CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
 await page.goto('http://127.0.0.1:'+port);await page.waitForFunction(()=>window.DitaApp?.state.root&&!window.DitaApp.workspace.busy);
 const check=(name,action)=>t.test(name,async()=>{try{await action();}catch(error){console.error(error);throw error;}});
 const open=file=>page.evaluate(file=>window.DitaApp.openFile(file),file);

 await check('menus disable unavailable actions and support arrows, focus return and panel-safe Escape',async()=>{
  assert.equal(await page.locator('#saveButton').isDisabled(),true);
  await page.locator('[data-menu=file]').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('[data-menu=file]').getAttribute('aria-expanded'),'true');assert.equal(await page.getByRole('menuitem',{name:'保存',exact:true}).isDisabled(),true);
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'新建文档');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.menu),'file');
  await open('a.dita');await page.click('#footnotesButton');await page.locator('.footnote-card').first().waitFor();await page.click('[data-menu=file]');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#footnotesPanel').isVisible(),true);assert.equal(await page.locator('#menuPopup').isVisible(),false);await page.click('[data-menu=file]');await page.locator('#visualEditor [data-dita-source=p]').first().click();assert.equal(await page.locator('#menuPopup').isVisible(),false);await page.click('#inspectorCloseButton');
 });
 await check('document tabs support keyboard switching and navigation tabs use one keyboard entry',async()=>{
  await open('b.dita');await page.locator('#tabs [data-path="a.dita"]').focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement.dataset.path==='b.dita');
  await page.keyboard.press('Home');await page.waitForFunction(()=>window.DitaApp.state.activePath==='a.dita'&&document.activeElement.dataset.path==='a.dita');
  await page.locator('.view-tab[data-view=map]').focus();await page.keyboard.press('End');assert.equal(await page.locator('.view-tab[tabindex="0"]').count(),1);assert.equal(await page.locator('#searchView').isVisible(),true);await page.keyboard.press('Home');
 });
 await check('outline matches source identities, ignores metadata titles and updates while writing',async()=>{
  await page.click('.view-tab[data-view=outline]');assert.deepEqual(await page.locator('.outline-item').allTextContents(),['Alpha','First section','Second section']);
  await page.getByRole('button',{name:'Second section',exact:true}).click();assert.equal(await page.locator('#visualEditor .author-focus').innerText(),'Second section');
  const heading=page.locator('#visualEditor h3').last();await heading.click();await page.keyboard.press('End');await page.keyboard.insertText(' Updated');await page.waitForFunction(()=>document.getElementById('outline').textContent.includes('Updated'));await page.click('#authorUndoButton');
  assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current),source);
 });
 await check('a pending workspace switch blocks editing and a failed switch restores the same buffer',async()=>{
  await page.click('.view-tab[data-view=map]');await page.click('#sourceButton');const before=await page.inputValue('#editor');let release,reached;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{reached=resolve;});
  const handler=async route=>{reached();await gate;await route.fulfill({status:409,contentType:'application/json',body:'{"error":"模拟切换失败"}'});};await page.route('**/api/branch',handler);
  try{await page.selectOption('#branchSelect','feature');await pending;assert.equal(await page.locator('.layout').evaluate(node=>node.inert),true);await page.keyboard.insertText('DURING_SWITCH');assert.equal(await page.inputValue('#editor'),before);release();await page.waitForFunction(()=>!window.DitaApp.workspace.busy);assert.equal(await page.locator('.layout').evaluate(node=>node.inert),false);assert.equal(await page.inputValue('#editor'),before);}finally{release();await page.unroute('**/api/branch',handler);}
  await page.click('#visualButton');
 });
 const showRules=async()=>{if(!await page.locator('#footnotesPanel').isVisible())await page.click('#footnotesButton');await page.locator('.footnote-card').first().waitFor();await page.click('#noteRulesButton');await page.locator('.note-rule-part').first().waitFor();};
 await check('switching note rows preserves partial choices and closing offers to keep them',async()=>{
  await showRules();await page.selectOption('[aria-label="片段 1 适用范围"]','common');await page.locator('#noteRuleList button').nth(1).click();await page.click('#noteRuleCommon');await page.locator('#noteRuleList button').first().click();assert.equal(await page.inputValue('[aria-label="片段 1 适用范围"]'),'common');assert.match(await page.locator('#noteRuleStatus').innerText(),/未保存/);
  page.once('dialog',dialog=>dialog.dismiss());await page.click('#noteRulesClose');assert.equal(await page.locator('#noteRulesDialog').isVisible(),true);page.once('dialog',dialog=>dialog.accept());await page.click('#noteRulesClose');await page.locator('#noteRulesDialog').waitFor({state:'hidden'});
 });
 await check('pending rule saves freeze fields and row selection until the response settles',async()=>{
  await showRules();await page.selectOption('[aria-label="片段 1 适用范围"]','common');await page.click('#noteRuleSuggestions');let release,reached;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{reached=resolve;});
  const handler=async route=>{if(route.request().method()==='PUT'){reached();await gate;}await route.continue();};await page.route('**/api/note-rules',handler);
  try{await page.click('#noteRuleSave');await pending;assert.equal(await page.locator('#noteRuleList button').first().isDisabled(),true);assert.equal(await page.locator('[aria-label="片段 1 适用范围"]').isDisabled(),true);assert.equal(await page.locator('#noteRulesClose').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#noteRulesDialog').isVisible(),true);release();await page.waitForFunction(()=>document.getElementById('noteRuleStatus').textContent.includes('已确认保存'));}finally{release();await page.unroute('**/api/note-rules',handler);}await page.click('#noteRulesClose');
 });
 await check('a slow rules read can be cancelled and a late response cannot reopen the window',async()=>{
  let release,reached,held=false;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{reached=resolve;});const handler=async route=>{if(!held&&route.request().method()==='GET'){held=true;const response=await route.fetch();reached();await gate;await route.fulfill({response});}else await route.continue();};await page.route('**/api/note-rules',handler);
  try{await page.click('#noteRulesButton');await pending;await page.click('#noteRulesClose');assert.equal(await page.locator('#noteRulesDialog').isVisible(),false);const response=page.waitForResponse(r=>r.url().endsWith('/api/note-rules'));release();await response;}finally{release();await page.unroute('**/api/note-rules',handler);}assert.equal(await page.locator('#noteRulesDialog').isVisible(),false);
 });
 await check('short narrow windows keep delivery actions and menu bounds visible',async()=>{
  await page.setViewportSize({width:390,height:520});await page.click('#exportMenuButton');await page.locator('#exportModel:not(:disabled)').waitFor();
  const bounds=await page.locator('#modelExportForm > .footnote-dialog-actions').evaluate(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,width:innerWidth,height:innerHeight};});assert.ok(bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.right<=bounds.width,JSON.stringify(bounds));
  assert.ok(await page.locator('.delivery-dialog-content').evaluate(node=>node.scrollHeight>node.clientHeight));if(process.env.DITA_QA_SCREENSHOTS)await page.screenshot({path:path.join(process.env.DITA_QA_SCREENSHOTS,'workspace-delivery-compact.png')});await page.click('#modelExportCancel');
  await page.click('[data-menu=help]');const menu=await page.locator('#menuPopup').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=390&&menu.y+menu.height<=520);await page.keyboard.press('Escape');await page.setViewportSize({width:1366,height:900});
 });
 await check('failed file opens show a status instead of an unhandled page rejection',async()=>{
  await page.locator('#tabs [data-path="b.dita"] .close').click();await page.click('.view-tab[data-view=search]');await page.fill('#workspaceSearchInput','b.dita');
  const handler=route=>route.fulfill({status:404,body:'missing'});await page.route('**/api/file?path=b.dita',handler);await page.locator('.workspace-result').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('missing'));await page.unroute('**/api/file?path=b.dita',handler);assert.equal(await page.evaluate(()=>window.DitaApp.state.activePath),'a.dita');
 });
 assert.deepEqual(errors,[]);assert.equal(await fs.readFile(path.join(repo,'a.dita'),'utf8'),source);
});
