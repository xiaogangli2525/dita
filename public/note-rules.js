'use strict';
(function(root){
  function createController(A){
    const core=root.DitaNoteRulesCore,get=id=>document.getElementById(id),dialog=get('noteRulesDialog');
    let snapshot,entries=[],selected=null,parts=[],generation=0,busy=false,knownModels=[];
    const el=(name,text)=>{const node=document.createElement(name);if(text!==undefined)node.textContent=text;return node;};
    const error=message=>{get('noteRulesError').textContent=message;};
    function decisions(){return parts.map(p=>({scope:p.scope.value,models:p.scope.value==='models'?[...new Set(p.models.value.trim().split(/\s+/).filter(Boolean))]:[]}));}
    function previewModels(){const previous=get('noteRulePreviewModel').value,models=[...new Set([...knownModels,...parts.flatMap(p=>p.models.value.trim().split(/\s+/).filter(Boolean))])].sort();get('noteRulePreviewModel').replaceChildren(new Option('全部型号（原始内容）',''));for(const m of models)get('noteRulePreviewModel').add(new Option(m,m));if(models.includes(previous))get('noteRulePreviewModel').value=previous;}
    function preview(){
      if(!selected)return;const model=get('noteRulePreviewModel').value,value=core.partition(selected).render(decisions(),model);
      get('noteRulePreview').textContent=parts.some(p=>p.scope.value==='pending')?'还有待确认片段；请先为每段选择“通用”或“适用型号”，再查看筛选结果。':root.DitaFootnotesCore.textOf(value).trim()||'此型号不保留该注脚，导出时会同步移除标记并重排编号。';
    }
    function select(note){
      selected=note;parts=[];get('noteRuleParts').replaceChildren();error('');get('noteRuleSource').textContent=note.path+' · 原注脚 '+(note.number||note.index+1);get('noteRuleOriginal').textContent=note.text;
      for(const button of get('noteRuleList').children)button.setAttribute('aria-current',String(button.dataset.key===core.key(note)));
      const saved=snapshot.noteRules.config.rules.find(r=>core.key(r)===core.key(note)),valid=saved&&core.matches(saved,note);
      get('noteRuleStatus').textContent=saved&&!valid?'原文已变化，旧规则已失效。请重新核对全部片段。':valid?'已有已确认规则；修改后需重新保存。':'建议仅供核对，尚未应用到导出。';
      const suggestions=core.suggest(note,[...(snapshot.project.models||[]),...A.manual.listModels(snapshot),...A.manual.discoverModels(snapshot).pending]);
      suggestions.forEach((part,i)=>{
        const row=el('section');row.className='note-rule-part';row.append(el('strong','片段 '+(i+1)),el('p',part.text));
        const label=el('label','适用范围'),scope=el('select');scope.setAttribute('aria-label','片段 '+(i+1)+' 适用范围');for(const [value,text]of [['pending','待确认'],['common','所有型号通用'],['models','指定适用型号']])scope.add(new Option(text,value));
        const modelLabel=el('label','适用型号（空格分隔）'),models=el('input');models.setAttribute('aria-label','片段 '+(i+1)+' 适用型号');models.setAttribute('list','noteRuleModels');scope.value=valid?saved.decisions[i].scope:'pending';models.value=valid?saved.decisions[i].models.join(' '):part.models.join(' ');
        label.append(scope);modelLabel.append(models);row.append(label,modelLabel,el('small',part.models.length?'原文提及：'+part.models.join('、')+'。提及不代表已确认适用，请核对支持／不支持的语义。':'未识别出明确的型号提及，请人工确认是否通用。'));
        function change(){error('');modelLabel.hidden=scope.value!=='models';previewModels();preview();}scope.addEventListener('change',change);models.addEventListener('input',()=>{error('');previewModels();preview();});parts.push({scope,models,suggestion:part.models});get('noteRuleParts').append(row);modelLabel.hidden=scope.value!=='models';
      });previewModels();get('noteRuleSave').disabled=!parts.length||busy;get('noteRuleDelete').disabled=!saved||busy;preview();
    }
    function drawList(){get('noteRuleList').replaceChildren();entries.forEach(note=>{const rule=snapshot.noteRules.config.rules.find(r=>core.key(r)===core.key(note)),state=rule?(core.matches(rule,note)?'已确认':'已过期'):'待确认',button=el('button',state+' · '+note.text.slice(0,52));button.type='button';button.dataset.key=core.key(note);button.title=note.path;button.addEventListener('click',()=>select(note));get('noteRuleList').append(button);});}
    async function show(preferred){
      const ticket=++generation;selected=null;parts=[];snapshot=null;busy=true;
      for(const id of ['noteRulesCount','noteRuleOriginal','noteRulePreview','noteRuleSource'])get(id).textContent='';get('noteRuleList').replaceChildren();get('noteRuleParts').replaceChildren();get('noteRuleStatus').textContent='正在读取手册与独立规则…';error('');get('noteRuleSave').disabled=true;get('noteRuleDelete').disabled=true;if(!dialog.open)dialog.showModal();
      try{
        const captured=await A.manual.capture(A.manual.scopePath(),{resources:true});if(ticket!==generation||!dialog.open)return;snapshot=captured;
        if(!snapshot.noteRules?.supported)throw Error('当前服务尚不支持独立导出规则，请更新服务端。');if(snapshot.noteRules.error)throw Error(snapshot.noteRules.error);
        const unique=new Map();for(const note of A.manual.listNotes(snapshot).notes){const source=note.sourceNote||note;unique.set(core.key(source),{...source,number:note.number});}entries=[...unique.values()];
        knownModels=[...new Set([...(snapshot.project.models||[]),...A.manual.listModels(snapshot),...A.manual.discoverModels(snapshot).pending])].sort();get('noteRulePreviewModel').replaceChildren(new Option('全部型号（原始内容）',''));get('noteRuleModels').replaceChildren();for(const model of knownModels){get('noteRulePreviewModel').add(new Option(model,model));const option=el('option');option.value=model;get('noteRuleModels').append(option);}if(knownModels.length)get('noteRulePreviewModel').value=knownModels[0];
        get('noteRulesCount').textContent=`当前手册 ${entries.length} 条来源注脚；规则单独保存，原始 DITA 不变。`;busy=false;drawList();const target=preferred&&(preferred.sourceNote||preferred),note=entries.find(n=>target&&core.key(n)===core.key(target))||entries[0];if(note)select(note);else get('noteRuleStatus').textContent='当前手册没有可配置的注脚。';
      }catch(e){if(ticket===generation){error(e.message);get('noteRuleStatus').textContent='读取失败，未修改任何原文或规则。';}}finally{if(ticket===generation)busy=false;}
    }
    async function persist(remove=false){
      if(busy||!snapshot||!selected)return;const ticket=generation,workspace=A.api.token;busy=true;get('noteRuleSave').disabled=true;get('noteRuleDelete').disabled=true;error('');
      try{
        if(!A.manual.current(snapshot))throw Error('原文或工作区已变化，请重新打开后核对；当前填写结果未写入。');
        const rule={path:selected.path,xmlPath:selected.xmlPath,expectedNote:selected.before,expectedContext:selected.context,expectedConditions:selected.conditions,confirmed:true,decisions:decisions()},config=core.validate({schema:1,rules:[...snapshot.noteRules.config.rules.filter(r=>core.key(r)!==core.key(selected)),...(remove?[]:[rule])]});
        const result=await A.noteRuleStore.save(config,snapshot.noteRules.expectedContent);if(ticket!==generation||workspace!==A.api.token||!dialog.open)return;
        snapshot.noteRules=result;drawList();busy=false;select(selected);get('noteRuleStatus').textContent=remove?'已移除独立规则，原始 DITA 不变。':'已确认保存独立规则。只在指定型号导出时应用，原始 DITA 不变。';A.setStatus('独立注脚导出规则已保存，原始 DITA 未修改');
      }catch(e){if(ticket===generation)error('规则未保存，当前选择仍保留。'+e.message);}finally{if(ticket===generation){busy=false;get('noteRuleSave').disabled=!selected;get('noteRuleDelete').disabled=!snapshot?.noteRules.config.rules.some(r=>selected&&core.key(r)===core.key(selected));}}
    }
    get('noteRulesButton').addEventListener('click',()=>show());get('noteRulesClose').addEventListener('click',()=>dialog.close());get('noteRuleSave').addEventListener('click',()=>persist());get('noteRuleDelete').addEventListener('click',()=>persist(true));get('noteRulePreviewModel').addEventListener('change',preview);
    get('noteRuleSuggestions').addEventListener('click',()=>{for(const p of parts)if(p.suggestion.length){p.scope.value='models';p.models.value=p.suggestion.join(' ');p.scope.dispatchEvent(new Event('change'));}preview();});get('noteRuleCommon').addEventListener('click',()=>{for(const p of parts){p.scope.value='common';p.scope.dispatchEvent(new Event('change'));}preview();});dialog.addEventListener('close',()=>{generation++;busy=false;});A.events.on('workspace:willChange',()=>dialog.close());return {show};
  }
  root.DitaNoteRules={createController};
})(window);
