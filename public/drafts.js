'use strict';
(function (root) {
  function createDraftController(A) {
    const get = id => document.getElementById(id), pending = new Map(), owned = new WeakMap();
    const scope = () => ({ root: A.state.root, branch: A.state.currentBranch });
    let store, timer, failed = false, notifiedConflict = '';
    try { store = root.DitaDraftStore.createDraftStore(root.localStorage); }
    catch (error) { console.warn('草稿存储初始化失败：', error.name); }
    function guarded(action) {
      try { if (!store) throw new Error('浏览器存储不可用'); action(); failed = false; }
      catch { if (!failed) A.toast('草稿备份不可用或空间不足，请及时保存或下载文档', 'error'); failed = true; }
    }
    function update() {
      guarded(() => {
        const drafts = store.list(scope()), count = drafts.length, versions = new Map();
        for (const draft of drafts) {
          if (!versions.has(draft.path)) versions.set(draft.path, new Set());
          versions.get(draft.path).add(JSON.stringify([draft.base, draft.current]));
        }
        const conflicts = [...versions].filter(([, values]) => values.size > 1).map(([path]) => path).sort();
        const signature = conflicts.length ? JSON.stringify([scope(), conflicts]) : '';
        if (signature && signature !== notifiedConflict) A.toast('同一文档有多个窗口或历史版本的草稿，已分别保留，请打开草稿核对。', 'info');
        notifiedConflict = signature;
        get('draftsButton').textContent = count ? '恢复草稿 (' + count + ')' + (conflicts.length ? ' · 有不同版本' : '') : '草稿';
        get('draftsButton').title = conflicts.length ? conflicts.join('、') + ' 有不同版本，已分别保留' : '查看可恢复的草稿';
        get('draftsButton').dataset.count = String(count);
      });
    }
    function flush() {
      clearTimeout(timer);
      guarded(() => {
        for (const { file, identity, owner } of pending.values()) {
          store.put(identity, file, owned.get(owner));
          if (file.dirty) owned.set(owner, file); else owned.delete(owner);
        }
        pending.clear();
      });
      update();
    }
    function changed(file) {
      if (A.state.filesMap.get(file.path) !== file) return;
      pending.set(JSON.stringify([A.state.root, A.state.currentBranch, file.path]), { file: { path: file.path, current: file.current, disk: file.disk, dirty: file.dirty }, identity: scope(), owner: file });
      clearTimeout(timer); timer = setTimeout(flush, 350);
    }
    function download(draft) { A.downloadXML(draft.current, draft.path.split('/').pop().replace(/\.(dita|xml|ditamap)$/i, '-draft.xml')); }
    function show() {
      flush(); get('draftList').replaceChildren(); get('draftError').textContent = '';
      guarded(() => {
        const drafts = store.list(scope());
        get('draftError').textContent = store.warnings?.length ? `${store.warnings.length} 份草稿无法读取；原始数据仍保留。` : '';
        if (!drafts.length) get('draftList').textContent = store.warnings?.length ? '没有可直接恢复的有效草稿。' : '当前仓库和分支没有待恢复草稿。';
        for (const draft of drafts) {
          const row = document.createElement('article'), title = document.createElement('strong'), time = document.createElement('small');
          row.dataset.draftId = draft.id;
          title.textContent = draft.path; time.textContent = (draft.fromCurrentWindow ? '当前窗口' : draft.schema === 1 ? '旧版草稿' : '其他窗口／较早会话') + ' · ' + new Date(draft.updatedAt).toLocaleString(); row.append(title, time);
          const preview = document.createElement('p'); preview.className = 'muted';
          const parsed = new DOMParser().parseFromString(draft.current, 'application/xml');
          preview.textContent = (parsed.querySelector('parsererror') ? draft.current : parsed.documentElement.textContent).replace(/\s+/g, ' ').trim().slice(0, 160);
          row.append(preview);
          const recover = document.createElement('button'); recover.type = 'button'; recover.textContent = '恢复到编辑区';
          recover.addEventListener('click', async () => {
            const workspace = A.api.token;
            try {
              await A.openFile(draft.path);
              if (workspace !== A.api.token) throw new Error('工作区已切换');
              const file = A.state.filesMap.get(draft.path);
              const response = await A.api.request('/api/file?path=' + encodeURIComponent(draft.path));
              if (!response.ok) throw new Error(await A.api.error(response));
              const freshDisk = await response.text();
              if (workspace !== A.api.token) throw new Error('工作区已切换');
              if (freshDisk !== draft.base || file.disk !== draft.base || file.dirty && file.current !== draft.current) throw new Error('磁盘或编辑内容已变化。请下载草稿，与当前文档比较后合并。');
              store.adopt(scope(), draft);
              A.setFileContent(file, draft.current); get('draftDialog').close();
              A.setStatus('草稿已恢复到编辑区，可撤销；点击保存后写入磁盘');
            } catch (error) { get('draftError').textContent = draft.path + '：' + error.message; }
          });
          const save = document.createElement('button'); save.type = 'button'; save.textContent = '下载草稿'; save.addEventListener('click', () => download(draft));
          const discard = document.createElement('button'); discard.type = 'button'; discard.textContent = '丢弃'; discard.addEventListener('click', () => {
            if (!confirm('丢弃这份恢复草稿？当前磁盘文件不会改变。')) return;
            try { store.remove(scope(), draft.path, draft); show(); }
            catch (error) { get('draftError').textContent = error.message; }
          });
          row.append(recover, save, discard); get('draftList').append(row);
        }
      });
      if (failed) get('draftError').textContent = '草稿存储无法读取，请保留当前内容并保存或下载文档。';
      if (!get('draftDialog').open) get('draftDialog').showModal();
    }
    A.events.on('document:changed', changed);
    A.events.on('workspace:willChange', flush);
    A.events.on('workspace:changed', update);
    A.events.on('file:opened', () => { update(); });
    // A clean disk version may coexist with a recoverable draft from an older
    // page. Only an explicit unsaved-change discard removes that backup.
    A.events.on('file:discarded', file => { guarded(() => store.remove(scope(), file.path)); });
    A.events.on('file:closed', path => { pending.delete(JSON.stringify([A.state.root, A.state.currentBranch, path])); update(); });
    root.addEventListener('pagehide', flush); root.addEventListener('beforeunload', flush);
    root.addEventListener('storage', event => {
      if (event.key && !/^dita\.draft\.v[12]:/.test(event.key)) return;
      if (get('draftDialog').open) show(); else update();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    get('draftsButton').addEventListener('click', show); get('draftClose').addEventListener('click', () => get('draftDialog').close());
    return { flush, update, show };
  }
  root.DitaDrafts = { createDraftController };
})(window);
