'use strict';
(function(root){
  function createController(A){
    let currentContent=null,generation=0,readSequence=0;
    A.events.on('workspace:willChange',()=>{generation++;currentContent=null;});
    async function read(){
      const ticket=++readSequence,token=A.api.token,epoch=generation,response=await A.api.request('/api/note-rules');
      if(token!==A.api.token||epoch!==generation)throw Error('工作区已切换，请重新打开规则');
      if(response.status===404)return {config:{schema:1,rules:[]},expectedContent:null,supported:false};
      if(!response.ok)throw Error(await A.api.error(response));const result=await response.json();
      if(token!==A.api.token||epoch!==generation)throw Error('工作区已切换，请重新打开规则');
      result.config=root.DitaNoteRulesCore.validate(result.config);if(ticket===readSequence)currentContent=result.expectedContent;return {...result,supported:true};
    }
    async function save(config,expectedContent){
      const token=A.api.token,epoch=generation;
      const response=await A.api.request('/api/note-rules',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({config:root.DitaNoteRulesCore.validate(config),expectedContent})});
      if(token!==A.api.token||epoch!==generation)throw Error('工作区已切换，请重新打开规则');if(!response.ok)throw Error(await A.api.error(response));const result=await response.json();
      if(token!==A.api.token||epoch!==generation)throw Error('工作区已切换，请重新打开规则');readSequence++;currentContent=result.expectedContent;A.events.emit('note-rules:changed');return {...result,supported:true};
    }
    return {read,save,current:s=>!s||!s.supported||s.expectedContent===currentContent,async verify(s){if(!s)return;const latest=await read();if(latest.error)throw Error(latest.error);if(latest.expectedContent!==s.expectedContent||latest.supported!==s.supported)throw Error('导出注脚规则已变化，请重新打开交付设置');}};
  }
  root.DitaNoteRuleStore={createController};
})(window);
