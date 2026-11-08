'use strict';
const { createSession } = require('../public/workspace-session');
const test=require('node:test'),assert=require('node:assert/strict');
const {createController}=require('../public/workspace-controller'),{createEvents}=require('../public/manual-core');
function fixture(){
 const file={path:'a.dita',current:'<topic>working</topic>',dirty:true};
 const state={root:'old',files:[],maps:[],filesMap:new Map([['a.dita',file]]),activePath:'a.dita',activeView:'map',currentBranch:'main',reviewGroups:new Map(),reviewDecisions:new Map()};
 const dom={rootPath:{},repositorySelect:{value:'new'},branchSelect:{value:'feature'},editor:{}};
 const messages=[],locks=[],requests=[],events=createEvents();let answer=true;
 const A={state,session:createSession(state),dom,events,saving:false,project:{load:async()=>{}},setStatus:text=>messages.push(text),toast(){},api:{token:'old',adopt(token){this.token=token;},error:async()=> 'denied',request:async(url,options)=>{requests.push([url,options]);return {ok:false};}}};
 const initialRequest=A.api.request;A.send=initialRequest;A.api.request=(...args)=>A.send(...args);
 const noop=()=>{},views={renderWorkspaceSwitches:noop,renderMapPicker:noop,renderTabs:noop,updateActivePanes:noop,updateTree:noop,setActiveView:noop,setSwitching:value=>locks.push(value),confirmDiscard:()=>answer};
 return {A,views,file,messages,locks,requests,setAnswer:value=>{answer=value;},controller:createController(A,views)};
}
test('workspace changes reject overlapping actions and preserve working buffers after failure',async()=>{
 const f=fixture();let release;const pending=new Promise(resolve=>{release=resolve;});f.A.send=async()=>{f.requests.push('branch');await pending;return {ok:false};};
 const first=f.controller.selectBranch();assert.equal(f.controller.busy,true);assert.equal(f.locks.at(-1),true);
 await f.controller.selectRepository();assert.equal(f.requests.length,1);release();await first;
 assert.equal(f.controller.busy,false);assert.equal(f.locks.at(-1),false);assert.equal(f.A.state.filesMap.get('a.dita'),f.file);assert.equal(f.A.state.root,'old');
});
test('saving or declined dirty confirmation never starts a workspace mutation',async()=>{
 const f=fixture();f.A.saving=true;await f.controller.selectBranch();f.A.saving=false;f.setAnswer(false);await f.controller.selectRepository();assert.equal(f.requests.length,0);assert.equal(f.A.state.filesMap.get('a.dita').current,'<topic>working</topic>');
});
test('workspace adoption is instance-local and keeps the branch matching manual without filename assumptions',async()=>{
 const a=fixture(),b=fixture();await a.controller.reloadWorkspace({root:'new',workspaceToken:'new-token',files:[],maps:[{path:'docs/first.ditamap'},{path:'docs/feature.ditamap'}],currentBranch:'feature'});
 assert.equal(a.A.state.selectedMap,'docs/feature.ditamap');assert.equal(a.A.state.filesMap.size,0);assert.equal(a.A.api.token,'new-token');assert.equal(b.A.api.token,'old');assert.equal(b.A.state.filesMap.get('a.dita'),b.file);assert.equal(a.locks.at(-1),false);
});
test('tree refresh rejects changed workspace identities before changing state',async()=>{
 const f=fixture();f.A.send=async()=>({ok:true,json:async()=>({workspaceToken:'other',root:'other',files:[],maps:[]})});await assert.rejects(f.controller.refreshWorkspaceTree(),/工作区已在其他窗口切换/);assert.equal(f.A.state.root,'old');assert.equal(f.A.state.filesMap.get('a.dita'),f.file);
});
test('a delayed source jump cannot focus or select a document opened later',async()=>{
 const {createController}=require('../public/document-navigation');let release,focused=0;
 const gate=new Promise(resolve=>{release=resolve;}),state={filesMap:new Map(),maps:[],activePath:'',mode:'visual'},events=createEvents();
 const session=createSession(state);
 const controller=createController({state,session,events,api:{token:'workspace'},dom:{editor:{focus(){focused++;},setSelectionRange(){focused++;}}},ditaCore:{collectPreviewPaths:()=>[]},setMode:mode=>session.setMode(mode),setStatus(){},ensureMapAuthorFile:async path=>{if(path==='slow.dita')await gate;const file={path,current:'<topic/>',gitStatus:'clean'};return session.registerDocument(file);}},{renderTabs(){},updateActivePanes(){},updateHistoryButtons(){},updateTree(){}});
 const pending=controller.navigateToSource('slow.dita');await controller.openFile('fast.dita');release();await assert.rejects(pending,/打开位置已变化/);assert.equal(state.activePath,'fast.dita');assert.equal(focused,0);assert.equal(state.mode,'visual');
});

test('invalid adoption leaves the token, buffers and lifecycle subscribers untouched', async()=>{
 const f=fixture();let changing=0;f.A.events.on('workspace:willChange',()=>{changing++;});
 await assert.rejects(f.controller.reloadWorkspace({root:'new',workspaceToken:'new',files:[],maps:[null]}),/响应无效/);
 assert.equal(changing,0);assert.equal(f.A.api.token,'old');assert.equal(f.A.state.filesMap.get('a.dita'),f.file);assert.equal(f.A.state.root,'old');assert.equal(f.controller.busy,false);
});
