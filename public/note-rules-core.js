'use strict';
(function(root){
  const xml=typeof module!=='undefined'?require('./xml-source'):root.DitaXmlSource;
  const notes=typeof module!=='undefined'?require('./footnotes-core'):root.DitaFootnotesCore;
  const manual=typeof module!=='undefined'?require('./manual-core'):root.DitaManualCore;
  const modelText=typeof module!=='undefined'?require('./model-note-text'):root.DitaModelNoteText;
  const key=note=>note.path+'\n'+note.xmlPath;
  const matches=(rule,note)=>Boolean(note&&rule.expectedNote===note.before&&rule.expectedContext===note.context&&JSON.stringify(rule.expectedConditions)===JSON.stringify(note.conditions));
  const groups=new Set(['div','p','ul','ol','li']);
  function partition(note){
    const source=note.inner,tree=xml.inspectSource('<wrapper>'+source+'</wrapper>'),offset=9,parts=[];
    const raw=node=>source.slice(node.start-offset,(node.close?.end??node.end)-offset);
    function sequence(children){
      const output=[];let buffer='';
      function flush(){if(!buffer)return;const value=buffer;buffer='';if(!notes.textOf(value).trim()&&!/<image\b/.test(value)){output.push({raw:value});return;}const index=parts.length;parts.push({xml:value,text:notes.textOf(value).trim()||'（图片）'});output.push({part:index});}
      for(const node of children){
        if(node.kind==='element'&&groups.has(node.name)&&node.close&&!node.children.some(child=>child.kind==='pi')){
          flush();output.push({open:source.slice(node.start-offset,node.end-offset),close:source.slice(node.close.start-offset,node.close.end-offset),children:sequence(node.children)});
        }else if(node.kind==='text'){
          for(const chunk of raw(node).match(/[^。！？\n]*[。！？\n]|[^。！？\n]+$/g)||[]){buffer+=chunk;if(/[。！？\n]$/.test(chunk))flush();}
        }else buffer+=raw(node);
      }
      flush();return output;
    }
    // Revision PIs crossing a fragment boundary must stay together.
    const layout=tree.children.some(node=>node.kind==='pi')?(parts.push({xml:source,text:notes.textOf(source).trim()}),[{part:0}]):sequence(tree.children);
    function render(decisions,model=''){
      function build(nodes){return nodes.map(node=>{
        if(node.raw!==undefined)return node.raw;
        if(node.part!==undefined){const d=decisions?.[node.part];return !model||d?.scope==='common'||d?.scope==='models'&&d.models.includes(model)?parts[node.part].xml:'';}
        const body=build(node.children);return body.trim()?node.open+body+node.close:'';
      }).join('');}return build(layout);
    }
    return {parts,render};
  }
  function suggest(note,models){return partition(note).parts.map(part=>({...part,scope:'pending',models:[...new Set(models)].filter(model=>{
    if(typeof model!=='string'||!model||manual.isModelMarker(model))return false;
    const escaped=model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^A-Za-z0-9_-])'+escaped+'(?=$|[^A-Za-z0-9_-])').test(part.text);
  })}));}
  function validate(config){
    if(!config||config.schema!==1||!Array.isArray(config.rules)||config.rules.length>500||JSON.stringify(config).length>1000000)throw Error('导出注脚规则格式无效或超过限制');
    const seen=new Set();const rules=config.rules.map(rule=>{
      // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted input.
      if(!rule||typeof rule.path!=='string'||rule.path.length>500||!/\.(dita|xml)$/i.test(rule.path)||/^(?:[a-z]+:|[/\\])|(?:^|\/)\.\.(?:\/|$)|[\\\x00-\x1f]/i.test(rule.path)||typeof rule.xmlPath!=='string'||!/^\d+(?:\/\d+)*$/.test(rule.xmlPath)||typeof rule.expectedNote!=='string'||rule.expectedNote.length>100000||typeof rule.expectedContext!=='string'||rule.expectedContext.length>20000||!Array.isArray(rule.expectedConditions)||rule.expectedConditions.some(value=>typeof value!=='string'||value.length>1000)||rule.confirmed!==true)throw Error('规则的来源或确认状态无效');
      const parsed=notes.listFootnotes(rule.expectedNote,rule.path);
      if(parsed.length!==1||xml.inspectSource(rule.expectedNote).name!=='fn')throw Error('规则必须绑定一条完整原始注脚');
      const parts=partition(parsed[0]).parts;
      if(!Array.isArray(rule.decisions)||rule.decisions.length!==parts.length||!parts.length)throw Error('规则片段与原始注脚不一致');
      const decisions=rule.decisions.map(item=>{
        if(!item||!['common','models'].includes(item.scope)||!Array.isArray(item.models))throw Error('每个片段都须确认通用或适用型号');
        const models=manual.validateProject({schema:1,models:item.models}).models;
        if(item.scope==='models'&&!models.length||item.scope==='common'&&models.length||models.some(manual.isModelMarker))throw Error('片段适用型号无效');return {scope:item.scope,models};
      });
      const result={path:rule.path,xmlPath:rule.xmlPath,expectedNote:rule.expectedNote,expectedContext:rule.expectedContext,expectedConditions:rule.expectedConditions,confirmed:true,decisions};
      if(seen.has(key(result)))throw Error('同一注脚存在重复规则');seen.add(key(result));return result;
    });return {schema:1,rules};
  }
  function project(files,config,model,{prefixes=false,profile,knownModels=[]}={}){
    config=validate(config||{schema:1,rules:[]});const output=new Map(files),confirmed=new Map(),excluded=new Map(),issues=[];
    let filteredParts=0,applied=0,prefixCandidates=0,prefixApplied=0,prefixExcluded=0,prefixProfileFiltered=0;
    if(!model)return {files:output,confirmed,excluded,filteredParts,applied,issues,prefixCandidates,prefixApplied,prefixExcluded,prefixProfileFiltered};
    for(const [path,file]of files){
      const rules=config.rules.filter(rule=>rule.path===path);
      const originals=notes.listFootnotes(file.current,path),matched=new Map(),replacements=[];
      for(const rule of rules){
        const note=originals.find(note=>note.xmlPath===rule.xmlPath);
        if(!matches(rule,note)){issues.push({path,message:'注脚规则已过期，请重新核对：'+rule.xmlPath});continue;}
        let inner=partition(note).render(rule.decisions,model);filteredParts+=rule.decisions.filter(d=>d.scope==='models'&&!d.models.includes(model)).length;
        if(prefixes){const compact=modelText.analyze({...note,before:'<fn>'+inner+'</fn>',inner},model,{knownModels});if(!compact.excluded&&!compact.unresolved.length)inner=compact.inner;}
        matched.set(note.xmlPath,!notes.textOf(inner).trim()&&!/<image\b/.test(inner));applied++;
        const opening=note.before.slice(0,note.openEnd-note.start).replace(/\/\s*>$/,'>');replacements.push({start:note.start,end:note.end,value:opening+inner+'</fn>'});
      }
      for(const note of originals){
        if(rules.some(rule=>rule.xmlPath===note.xmlPath)||note.common||!manual.matches(note.conditions,model))continue;
        const projected=modelText.analyze(note,model,{profile,knownModels});
        if(projected.scoped||projected.unresolved.length)prefixCandidates++;
        if(!prefixes)continue;
        if(projected.unresolved.length){issues.push({path,xmlPath:note.xmlPath,kind:'model-scope',message:'注脚含不能按明确前缀判断的型号说明，请核对独立规则：'+projected.unresolved[0].slice(0,100)});continue;}
        if(!projected.scoped)continue;
        prefixApplied++;prefixExcluded+=projected.excluded;prefixProfileFiltered+=projected.profileFiltered;
        const inner=projected.inner,opening=note.before.slice(0,note.openEnd-note.start).replace(/\/\s*>$/,'>');
        matched.set(note.xmlPath,!notes.textOf(inner).trim()&&!/<image\b/.test(inner));
        replacements.push({start:note.start,end:note.end,value:opening+inner+'</fn>'});
      }
      let source=file.current;for(const item of replacements.sort((a,b)=>b.start-a.start))source=source.slice(0,item.start)+item.value+source.slice(item.end);
      xml.validateXml(source);output.set(path,{...file,current:source});
      for(const note of notes.listFootnotes(source,path))if(matched.has(note.xmlPath)){
        if(!confirmed.has(path))confirmed.set(path,new Set());confirmed.get(path).add(note.start);
        if(matched.get(note.xmlPath)){if(!excluded.has(path))excluded.set(path,new Set());excluded.get(path).add(note.start);}
      }
    }return {files:output,confirmed,excluded,filteredParts,applied,issues,prefixCandidates,prefixApplied,prefixExcluded,prefixProfileFiltered};
  }
  const api={key,matches,partition,suggest,validate,project};if(typeof module!=='undefined')module.exports=api;else root.DitaNoteRulesCore=api;
})(typeof window==='undefined'?globalThis:window);
