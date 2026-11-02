'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright-core'),{unzipSync,strFromU8}=require('fflate');
const {collectDemoFiles}=require('../scripts/demo-workspace');
test('real HTTP delivery has one note frame, readable filter labels and reviewed text-model filtering',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dita-model-export-')),repo=path.join(temp,'docs');await fs.mkdir(repo);
 const corpus=collectDemoFiles(path.join(__dirname,'../examples/http_httpsusermanual'),'http_httpsusermanual.ditamap');
 for(const[p,b]of corpus){await fs.mkdir(path.dirname(path.join(repo,p)),{recursive:true});await fs.writeFile(path.join(repo,p),b);}
 const sample='<topic id="sample"><title>Sample</title><body><note><p>创建实例前设置 SSL 参数。</p></note><p>Command<fn>COMMON。<div>A1/B2：<b>KEEP_SHARED</b>。</div><div>B2：OTHER_ONLY。</div></fn></p></body></topic>';
 for(const[p,s]of Object.entries({'.dita-project.json':JSON.stringify({schema:1,models:['ML307G','ML307N','MN319-A','A1','B2']}),'sample.dita':sample,'sample.ditamap':'<map><title>Sample</title><topicref href="sample.dita"/></map>','ambiguous.dita':'<topic><title>Ambiguous</title><body><p>Command<fn>请根据B2的行为核对。</fn></p></body></topic>','ambiguous.ditamap':'<map><title>Ambiguous</title><topicref href="ambiguous.dita"/></map>'}))await fs.writeFile(path.join(repo,p),s);
 for(const args of [['init'],['add','.'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture']])execFileSync('git',args,{cwd:repo,stdio:'ignore'});
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,DOCS_ROOT:repo,REPOSITORIES_ROOT:temp,PORT:String(port)},stdio:['ignore','pipe','pipe']});let browser;
 t.after(async()=>{await browser?.close();if(server.exitCode==null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await fs.rm(temp,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.DITA_CHROMIUM_EXECUTABLE?{executablePath:process.env.DITA_CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto('http://127.0.0.1:'+port);await page.waitForFunction(()=>window.DitaApp?.state.root);
 const open=file=>page.evaluate(file=>window.DitaApp.openFile(file),file),delivery=async()=>{await page.click('#exportMenuButton');await page.locator('#exportModel:not(:disabled)').waitFor();};
 const download=async()=>{const pending=page.waitForEvent('download',{timeout:15000});await page.click('#modelExportForm [value=download]');return fs.readFile(await(await pending).path());};
 const check=(name,fn)=>t.test(name,async()=>{try{await fn();}catch(error){console.error(error);throw error;}});
 await open('http_httpsusermanual.ditamap');
 await check('actual filter rules have Chinese descriptions and unresolved text scopes cannot silently ship',async()=>{
  await delivery();assert.match(await page.locator('#exportFilter option[value="filters/filter_tbd.ditaval"]').innerText(),/排除产品标记为“待定（tbd）”/);
  await page.selectOption('#exportFilter','filters/filter_tbd.ditaval');await page.waitForFunction(()=>!document.getElementById('exportModel').disabled);await page.selectOption('#exportModel','ML307G');
  assert.match(await page.locator('#exportFilterHint').innerText(),/排除产品标记为“待定（tbd）”/);assert.equal(await page.isChecked('#exportPrefixNotes'),false);
  await page.click('#modelExportForm [value=check]');await page.waitForFunction(()=>document.getElementById('modelExportError').textContent.includes('启用'));
  await page.click('[data-delivery-step=configure]');await page.check('#exportPrefixNotes');assert.match(await page.locator('#modelExportSummary').innerText(),/已按明确型号前缀处理/);
 });
 for(const model of ['ML307G','ML307N','MN319-A'])await check('actual '+model+' HTML contains only its retained note labels and one frame per note',async()=>{
  if(!await page.locator('#modelExportDialog').isVisible())await delivery();await page.selectOption('#exportModel',model);
  const html=(await download()).toString(),doc=await browser.newPage({viewport:{width:1200,height:1000}});await doc.setContent(html);
  assert.equal(await doc.locator('.dita-note .dita-note,.note-icon').count(),0);
  const text=await doc.locator('.export-footnotes').innerText(),names=text.match(/\b(?:ML|MN|MR)\d+[A-Z0-9]*(?:-[A-Z0-9]+)*\b/g)||[];assert.ok(names.length);assert.ok(names.every(name=>name===model),names.join(','));
  assert.match(text,/分包是在网络包/);assert.equal(await doc.locator('.footnote-backlink').count(),await doc.locator('.export-footnotes > ol > li').count());
  if(model==='ML307G'&&process.env.DITA_QA_SCREENSHOTS){const note=doc.locator('.dita-note').filter({hasText:/创建HTTP实例前/}).first();await note.screenshot({path:path.join(process.env.DITA_QA_SCREENSHOTS,'http-export-note.png')});await doc.locator('.export-footnotes').screenshot({path:path.join(process.env.DITA_QA_SCREENSHOTS,'http-export-footnotes.png')});}
  await doc.close();assert.equal(await page.evaluate(()=>window.DitaApp.lastDeliveryRecord.modelNotePrefixPolicy),'explicit-prefix-v1');
 });
 await open('sample.ditamap');
 for(const format of ['html','md','pdf','docx'])await check('confirmed prefix policy is shared by '+format+' delivery',async()=>{
  await delivery();await page.selectOption('#exportModel','A1');await page.check('#exportPrefixNotes');await page.selectOption('#exportFormat',format);const bytes=await download();
  if(format==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  else{const output=format==='docx'?strFromU8(unzipSync(bytes)['word/document.xml']):bytes.toString();assert.match(output,/KEEP_SHARED/);assert.doesNotMatch(output,/OTHER_ONLY|B2/);}
 });
 await check('changing the prefix choice invalidates checked output and all-model export preserves originals',async()=>{
  await delivery();await page.selectOption('#exportModel','A1');await page.selectOption('#exportFormat','html');await page.click('#modelExportForm [value=check]');await page.waitForFunction(()=>document.getElementById('deliveryCheckStatus').textContent.includes('检查通过'));
  await page.click('[data-delivery-step=configure]');await page.uncheck('#exportPrefixNotes');await page.click('#modelExportForm [value=download]');await page.waitForFunction(()=>document.getElementById('modelExportError').textContent.includes('启用'));
  await page.click('[data-delivery-step=configure]');await page.selectOption('#exportModel','');const html=(await download()).toString();assert.match(html,/OTHER_ONLY|B2/);
 });
 await check('ambiguous prose opens the independent-rule review instead of deleting content',async()=>{
  await open('ambiguous.ditamap');await delivery();await page.selectOption('#exportModel','A1');await page.check('#exportPrefixNotes');await page.waitForFunction(()=>document.getElementById('modelExportError').textContent.includes('核对'));
  await page.click('#exportReviewRules');await page.locator('#noteRulesDialog').waitFor({state:'visible'});await page.locator('.note-rule-part').first().waitFor();assert.match(await page.locator('.note-rule-part').innerText(),/B2/);await page.click('#noteRulesClose');
 });
 for(const[p,b]of corpus)assert.deepEqual(await fs.readFile(path.join(repo,p)),b);assert.equal(await fs.readFile(path.join(repo,'sample.dita'),'utf8'),sample);assert.deepEqual(errors,[]);
});
