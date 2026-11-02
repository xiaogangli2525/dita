'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {chromium}=require('playwright-core'),{unzipSync,strFromU8}=require('fflate');
test('real author compatibility and DITAVAL delivery share captured source and output rules',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dita-profiling-')),repo=path.join(temp,'docs');await fs.mkdir(path.join(repo,'filters'),{recursive:true});
 const intro="<?xml version='1.0' encoding='UTF-8'?>\r\n<concept id='intro'><title>引言</title><shortdesc>手册摘要</shortdesc><prolog><author>A</author></prolog></concept>";
 const topic='<topic id="t"><title>HTTP 指令</title><shortdesc>参数说明</shortdesc><body><p>Public<fn>FIRST_NOTE</fn><ph product="tbd">PRIVATE_INLINE</ph></p><div product="tbd"><p>PRIVATE_BODY<fn>PRIVATE_NOTE</fn><image href="missing.png"/><xref href="missing.dita"/></p></div><fn id="private" product="tbd">PRIVATE_DEFINITION</fn><p>Reference<xref type="fn" href="#t/private"/>Tail<fn>LAST_NOTE</fn></p><p><image href="logo.svg" scale="30"/></p><table><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry namest="c1" nameend="c2">MERGED 中文</entry></row></tbody></tgroup></table><msgblock id="response">+HTTP: 0,0\n  OK</msgblock><note id="typed-note" type="note"><p>Rich <b>note</b> content.</p></note><table><tgroup cols="2"><thead><row><entry>模组系列</entry><entry>模组子型号</entry></row></thead><tbody><row><entry>M100</entry><entry>M100-A</entry></row><row><entry>M300</entry><entry>M300-A</entry></row><row product="tbd"><entry>M999</entry><entry>M999-A</entry></row></tbody></tgroup></table></body></topic>';
 const filter='<val><prop att="product" val="tbd" action="exclude"/></val>';
 for(const [name,content]of Object.entries({'.dita-project.json':'{"schema":1,"models":["tbd"]}','intro.dita':intro,'a.dita':topic,'main.ditamap':'<map><title>HTTP 手册</title><topicref href="intro.dita"/><topicref href="a.dita"/></map>','filters/release.ditaval':filter,'filters/invalid.ditaval':'<val><prop att="product" action="flag"/></val>','logo.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>'}))await fs.writeFile(path.join(repo,name),content);
 for(const args of [['init'],['add','.'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture']])execFileSync('git',args,{cwd:repo,stdio:'ignore'});
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,DOCS_ROOT:repo,REPOSITORIES_ROOT:temp,PORT:String(port)},stdio:['ignore','pipe','pipe']});let browser;
 t.after(async()=>{await browser?.close();if(server.exitCode==null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await fs.rm(temp,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.DITA_CHROMIUM_EXECUTABLE?{executablePath:process.env.DITA_CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.goto('http://127.0.0.1:'+port);await page.waitForFunction(()=>window.DitaApp?.state.root);
 const open=async file=>{await page.evaluate(file=>window.DitaApp.openFile(file),file);await page.waitForFunction(file=>window.DitaApp.state.activePath===file,file);};
 const current=()=>page.evaluate(()=>window.DitaApp.state.filesMap.get('intro.dita').current);
 const insert=async(selector,text)=>{await page.locator(selector).click();await page.evaluate(selector=>{const n=document.querySelector(selector),r=document.createRange();r.selectNodeContents(n);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);},selector);await page.keyboard.insertText(text);};
 await t.test('bodyless title and root summary can be written and undone without adding an empty body',async()=>{
  await open('intro.dita');assert.equal(await page.locator('#visualEditor [data-dita-source=shortdesc]').innerText(),'手册摘要');
  await insert('#visualEditor [data-dita-source=shortdesc]',' NEW_SUMMARY');await page.waitForFunction(()=>window.DitaApp.state.filesMap.get('intro.dita').current.includes('NEW_SUMMARY'));
  assert.equal(await current(),intro.replace('手册摘要','手册摘要 NEW_SUMMARY'));await page.click('#authorUndoButton');assert.equal(await current(),intro);
  await insert('#visualEditor h2',' NEW_TITLE');await page.waitForFunction(()=>window.DitaApp.state.filesMap.get('intro.dita').current.includes('NEW_TITLE'));await page.click('#authorUndoButton');assert.equal(await current(),intro);
  await insert('#visualEditor [data-dita-placeholder]','新增正文');await page.waitForFunction(()=>window.DitaApp.state.filesMap.get('intro.dita').current.includes('新增正文'));
  assert.match(await current(),/<\/prolog><conbody><p>新增正文<\/p><\/conbody>/);await page.click('#authorUndoButton');assert.equal(await current(),intro);
  await insert('#visualEditor [data-dita-source=shortdesc]','');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.DitaApp.state.filesMap.get('intro.dita').current.includes('<conbody>'));
  await page.keyboard.insertText('ENTER_BODY');await page.waitForFunction(()=>window.DitaApp.state.filesMap.get('intro.dita').current.includes('ENTER_BODY'));
  await page.click('#authorUndoButton');await page.click('#authorUndoButton');assert.equal(await current(),intro);
 });
 await t.test('images without alt and root summaries roundtrip exactly in the actual browser DOM',async()=>{
  const result=await page.evaluate(({topic,intro})=>{const c=window.DitaApp.ditaCore;return [topic,intro].map(source=>c.updateCurrentFromVisual(null,{visualEditor:c.createAuthorTopic(source,document,false,'a.dita')},source)===source);},{topic,intro});assert.deepEqual(result,[true,true]);
 });
 await t.test('all note types switch safely and selected response blocks stay readable',async()=>{
  await open('a.dita');
  const baseline=await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current);
  const note=page.locator('#visualEditor [data-dita-source=note]');await note.click();await page.click('#inspectorToggleButton');
  assert.equal(await page.locator('#contentNoteType option').count(),13);
  for(const type of ['tip','important','attention','caution','warning','danger','notice','restriction','remember','fastpath','trouble','other']){
   await note.click();await page.selectOption('#contentNoteType',type);assert.ok((await note.getAttribute('class')).split(/\s+/).includes(type));
   if(type==='other'){await page.fill('#contentNoteTitle','固件兼容性');await page.locator('#contentNoteTitle').press('Tab');assert.equal(await note.getAttribute('data-dita-note-label'),'固件兼容性');await page.click('#authorUndoButton');}
   await page.click('#authorUndoButton');assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current),baseline);
  }
  await page.click('#inspectorCloseButton');await page.locator('#visualEditor pre').click();
  const contrast=await page.locator('#visualEditor pre').evaluate(node=>{const s=getComputedStyle(node);const lum=rgb=>{const a=rgb.match(/[\d.]+/g).slice(0,3).map(n=>{n=Number(n)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;};const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert.ok(contrast>=4.5,'selected code remains legible');
  assert.equal(await page.locator('#visualEditor pre').innerText(),'+HTTP: 0,0\n  OK');
 });
 await t.test('model discovery separates release markers from series and saving does not block delivery',async()=>{
  await page.click('#projectButton');assert.equal(await page.inputValue('#projectModels'),'');
  await page.click('#projectDiscover');await page.waitForFunction(()=>document.getElementById('projectModels').value.includes('M300'));
  assert.equal(await page.inputValue('#projectModels'),'M100\nM300');assert.match(await page.locator('#projectDiscoverySummary').innerText(),/tbd/);assert.match(await page.locator('#projectDiscoverySummary').innerText(),/M999/);
  const denied=async route=>{if(route.request().method()==='PUT')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'创建临时文件失败（EPERM）'})});return route.continue();};
  await page.route('**/api/project',denied);await page.click('#projectForm button[type=submit]');await page.waitForFunction(()=>document.getElementById('projectError').textContent.includes('EPERM'));
  assert.equal(await page.locator('#projectDialog').isVisible(),true);assert.equal(await page.inputValue('#projectModels'),'M100\nM300');assert.match(await page.locator('#projectError').innerText(),/当前填写内容仍保留/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(repo,'.dita-project.json'),'utf8')).models,['tbd']);
  await page.unroute('**/api/project',denied);
  await page.click('#projectForm button[type=submit]');await page.locator('#projectDialog').waitFor({state:'hidden'});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(repo,'.dita-project.json'),'utf8')).models,['M100','M300']);
  assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current),topic);
 });
 await open('main.ditamap');
 const delivery=async()=>{await page.click('#exportMenuButton');await page.locator('#exportModel:not(:disabled)').waitFor();};
 const selectFilter=async value=>{await page.selectOption('#exportFilter',value);await page.waitForFunction(()=>!document.querySelector('#modelExportForm [value=download]').disabled);};
 await t.test('invalid profiles explain the error and can be replaced without reopening delivery',async()=>{
  await delivery();assert.deepEqual(await page.locator('#exportModel option').evaluateAll(nodes=>nodes.map(n=>n.value)),['','M100','M300']);assert.deepEqual(await page.locator('#exportFilter option').evaluateAll(nodes=>nodes.map(n=>n.value)),['','filters/invalid.ditaval','filters/release.ditaval']);
  await page.selectOption('#exportFilter','filters/invalid.ditaval');await page.waitForFunction(()=>document.getElementById('modelExportError').textContent.includes('action'));
  assert.equal(await page.locator('#modelExportForm [value=download]').isDisabled(),true);
  await selectFilter('filters/release.ditaval');assert.match(await page.locator('#modelExportSummary').innerText(),/正文条件排除/);assert.equal(await page.locator('#modelExportError').innerText(),'');
 });
 await t.test('a late profile read cannot replace a newer selection',async()=>{
  let release,reached;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{reached=resolve;});
  const matcher='**/api/file?*';const handler=async route=>{if(new URL(route.request().url()).searchParams.get('path')==='filters/invalid.ditaval'){reached();await gate;}await route.continue();};
  await page.route(matcher,handler);await page.selectOption('#exportFilter','filters/invalid.ditaval');await pending;
  await selectFilter('filters/release.ditaval');const response=page.waitForResponse(r=>new URL(r.url()).searchParams.get('path')==='filters/invalid.ditaval');release();await response;
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));assert.equal(await page.locator('#exportFilter').inputValue(),'filters/release.ditaval');assert.equal(await page.locator('#modelExportError').innerText(),'');await page.unroute(matcher,handler);
 });
 for(const format of ['html','pdf','docx'])await t.test('profile applies to '+format+' and delivery records its exact input hash',async()=>{
  if(!await page.locator('#modelExportDialog').isVisible())await delivery();await page.selectOption('#exportFormat',format);
  const waiting=page.waitForEvent('download',{timeout:60000});await page.click('#modelExportForm [value=download]');const download=await waiting,bytes=await fs.readFile(await download.path());
  if(format==='html'){const html=bytes.toString();assert.doesNotMatch(html,/PRIVATE_|missing\.png|missing\.dita/);assert.match(html,/FIRST_NOTE/);assert.match(html,/LAST_NOTE/);assert.equal((html.match(/id="fn-\d+"/g)||[]).length,2);assert.match(html,/data:image/);assert.match(html,/colspan="2"/);}
  if(format==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  if(format==='docx'){const zip=unzipSync(bytes),xml=strFromU8(zip['word/document.xml']);assert.doesNotMatch(xml,/PRIVATE_/);assert.match(xml,/FIRST_NOTE|LAST_NOTE/);assert.match(xml,/w:gridSpan w:val="2"/);assert.ok(Object.keys(zip).some(name=>/^word\/media\//.test(name)));}
  await page.waitForFunction(format=>window.DitaApp.lastDeliveryRecord?.format===format,format);const record=await page.evaluate(()=>window.DitaApp.lastDeliveryRecord);
  assert.equal(record.filterPath,'filters/release.ditaval');assert.equal(record.documents.find(d=>d.path===record.filterPath).sha256,createHash('sha256').update(filter).digest('hex'));assert.equal(record.outputSha256,createHash('sha256').update(bytes).digest('hex'));
 });
 await t.test('a changed filter buffer invalidates captured delivery and cannot download stale output',async()=>{
  await delivery();await page.evaluate(filter=>{const a=window.DitaApp;a.state.filesMap.set('filters/release.ditaval',{path:'filters/release.ditaval',current:'<val/>',disk:filter,dirty:true});},filter);
  await page.click('#modelExportForm [value=download]');await page.waitForFunction(()=>document.getElementById('modelExportError').textContent.includes('内容已变化'));
  await page.click('#modelExportCancel');await page.evaluate(()=>window.DitaApp.state.filesMap.delete('filters/release.ditaval'));
 });
 if(process.platform==='linux')await t.test('missing CJK fonts fail native PDF generation with an actionable error',async()=>{
  const fonts=path.join(temp,'empty-fonts');await fs.mkdir(fonts);const config=path.join(temp,'empty-fonts.conf');await fs.writeFile(config,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${fonts}</dir><cachedir>${temp}/font-cache</cachedir></fontconfig>`);
  const script="require('./lib/pdf-export').createPdf('<p>中文用户手册</p>').then(()=>process.exit(2)).catch(e=>{if(e.status!==503)throw e;console.log(e.message);})";
  const child=spawn(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,FONTCONFIG_FILE:config},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,0,output);assert.match(output,/PDF 中文字体未就绪/);
 });
 assert.deepEqual(errors,[]);assert.equal(await fs.readFile(path.join(repo,'intro.dita'),'utf8'),intro);assert.equal(await fs.readFile(path.join(repo,'a.dita'),'utf8'),topic);
});
