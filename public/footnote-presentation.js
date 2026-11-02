'use strict';
(function (root) {
  // One presentation snapshot supplies Author markers, the list and edit labels.
  // Updating a number never edits XML or creates a document history entry.
  function createController(A) {
    let scope = '', snapshot = null, data = null, generation = 0, pending = null, timer;
    const key = (path, xmlPath) => path + '\n' + xmlPath;
    let locations = new Map();
    function current() { return snapshot && data && snapshot.path === scope && A.manual.current(snapshot); }
    function labels(calls) { return [...new Set(calls.map(call => call.note.label))].join('、'); }
    function apply() {
      const valid = current(), surfaces = A.dom.visualEditor.classList.contains('map-author-editor') ? A.dom.visualEditor.querySelectorAll('.map-topic-surface') : [A.dom.visualEditor];
      for (const surface of surfaces) {
        const path = surface.dataset.mapTopicPath || A.state.activePath, file = A.state.filesMap.get(path);
        const fresh = valid && file && surface.ditaSourceContent === file.current;
        for (const marker of surface.querySelectorAll('.fn-ref[data-dita-source]')) {
          const calls = fresh ? locations.get(key(path, marker.ditaSourcePath)) || [] : [];
          const label = calls.length ? labels(calls) : marker.dataset.fnDefinition === 'true' && fresh ? '定义' : '?';
          const definition = marker.dataset.fnDefinition === 'true';
          const caption = definition ? calls.length ? '定义 ' + label : fresh ? '未引用定义' : '定义 ?' : label;
          const text = '[' + caption + ']'; if (marker.textContent !== text) marker.textContent = text;
          marker.setAttribute('aria-label', (definition ? '注脚定义 ' : '注脚 ') + (label === '?' ? '编号待确认' : label) + '，单击查看详情，双击或按 Enter 编辑');
          if (calls.length) { marker.dataset.fnNumber = calls.map(call => call.number).join(','); marker.title = calls[0].note.text + ' · ' + (calls[0].note.common ? '已确认通用' : calls[0].note.conditions.join(' ∩ ') || '待确认范围') + ' · 单击查看详情，双击编辑'; }
          else { delete marker.dataset.fnNumber; marker.title = label === '定义' ? '未引用的注脚定义，不参与编号' : '编号暂未确认，请检查手册或引用'; }
        }
      }
    }
    function publish(next, value) {
      snapshot = next; data = value; locations = new Map();
      // A visible occurrence takes precedence over its reusable source origin.
      for (const call of value.calls) {
        const id = key(call.path, call.xmlPath), list = locations.get(id) || [];
        if (call.origin && list.some(item => !item.origin)) continue;
        if (!call.origin && list.every(item => item.origin)) list.length = 0;
        list.push(call); locations.set(id, list);
      }
      apply(); A.events.emit('footnotes:numbered', { scope, data }); return data;
    }
    function fromBuffers() {
      if (!snapshot || snapshot.path !== scope) return null;
      const scopeFile = A.state.filesMap.get(scope);
      if (/\.ditamap$/i.test(scope) && scopeFile && scopeFile.current !== snapshot.content) return null;
      const files = new Map(Array.from(snapshot.files, ([path, file]) => [path, { ...file, current: A.state.filesMap.get(path)?.current ?? file.current }]));
      const next = { ...snapshot, files, content: scopeFile?.current ?? snapshot.content,
        buffers: new Map(Array.from(A.state.filesMap, ([path, file]) => [path, root.DitaDocumentStore.snapshotDocument(file)])) };
      if (!A.manual.current(next)) return null;
      try { return publish(next, A.manual.listNotes(next)); } catch { return null; }
    }
    async function ready() {
      if (!scope) scope = A.state.activePath;
      if (!scope) throw new Error('请先打开功能手册');
      if (current()) { apply(); return data; }
      const local = fromBuffers(); if (local) return local;
      if (pending?.generation === generation) return pending.promise;
      const started = generation, path = scope;
      const promise = A.manual.capture(path).then(next => {
        if (generation !== started || scope !== path) return ready();
        return publish(next, A.manual.listNotes(next));
      }).catch(error => { if (generation === started) { data = null; apply(); } throw error; })
        .finally(() => { if (pending?.promise === promise) pending = null; });
      pending = { generation: started, promise }; return promise;
    }
    function hasMarkers() { return Boolean(A.dom.visualEditor.querySelector('.fn-ref')); }
    function schedule() { clearTimeout(timer); timer = setTimeout(() => { if (hasMarkers()) ready().catch(() => {}); }, 40); }
    function setScope(path) {
      if (scope !== path) { scope = path; snapshot = data = null; locations.clear(); generation++; }
      apply(); if (scope) schedule();
    }
    A.events.on('author:rendered', () => { apply(); if (hasMarkers()) ready().catch(() => {}); });
    A.events.on('document:changed', file => { if (file.path === scope || snapshot?.files.has(file.path)) { generation++; schedule(); } });
    A.events.on('project:changed', () => { generation++; schedule(); });
    A.events.on('file:closed', () => { generation++; snapshot = data = null; if (!A.state.filesMap.has(scope) && !A.state.maps.some(map => map.path === scope)) scope = A.state.activePath; schedule(); });
    A.events.on('workspace:willChange', () => { generation++; scope = ''; snapshot = data = null; locations.clear(); clearTimeout(timer); });
    return { setScope, ready, apply, get scope() { return scope; }, async resolve(path, xmlPath) {
      await ready(); const calls = locations.get(key(path, xmlPath));
      return calls?.length ? { ...calls[0].note, displayLabel: labels(calls) } : null;
    } };
  }
  root.DitaFootnotePresentation = { createController };
})(window);
