'use strict';
(function (root) {
  function createDraftController(A) {
    const get = id => document.getElementById(id), pending = new Map();
    const scope = () => ({ root: A.state.root, branch: A.state.currentBranch });
    let store, timer, failed = false;
    try { store = root.DitaDraftStore.createDraftStore(root.localStorage); } catch {}
    function guarded(action) {
      try { if (!store) throw new Error('浏览器存储不可用'); action(); failed = false; }
      catch { if (!failed) A.toast('草稿备份不可用或空间不足，请及时保存或下载文档', 'error'); failed = true; }
    }
    function update() {
      guarded(() => {
        const count = store.list(scope()).length;
        get('draftsButton').textContent = count ? '恢复草稿 (' + count + ')' : '草稿';
        get('draftsButton').dataset.count = String(count);
      });
    }
    function flush() {
      clearTimeout(timer);
      guarded(() => { for (const { file, identity } of pending.values()) store.put(identity, file); pending.clear(); });
      update();
    }
    function changed(file) {
      if (A.state.filesMap.get(file.path) !== file) return;
      pending.set(JSON.stringify([A.state.root, A.state.currentBranch, file.path]), { file: { path: file.path, current: file.current, disk: file.disk, dirty: file.dirty }, identity: scope() });
      clearTimeout(timer); timer = setTimeout(flush, 350);
    }
    function download(draft) { A.downloadXML(draft.current, draft.path.split('/').pop().replace(/\.(dita|xml|ditamap)$/i, '-draft.xml')); }
    function show() {
      flush(); get('draftList').replaceChildren();
      guarded(() => {
        const drafts = store.list(scope());
        if (!drafts.length) get('draftList').textContent = '当前仓库和分支没有待恢复草稿。';
        for (const draft of drafts) {
          const row = document.createElement('article'), title = document.createElement('strong'), time = document.createElement('small');
          title.textContent = draft.path; time.textContent = new Date(draft.updatedAt).toLocaleString(); row.append(title, time);
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
              A.setFileContent(file, draft.current); get('draftDialog').close();
              A.setStatus('草稿已恢复到编辑区，可撤销；点击保存后写入磁盘');
            } catch (error) { get('draftError').textContent = draft.path + '：' + error.message; }
          });
          const save = document.createElement('button'); save.type = 'button'; save.textContent = '下载草稿'; save.addEventListener('click', () => download(draft));
          const discard = document.createElement('button'); discard.type = 'button'; discard.textContent = '丢弃'; discard.addEventListener('click', () => {
            if (!confirm('丢弃这份恢复草稿？当前磁盘文件不会改变。')) return;
            guarded(() => store.remove(scope(), draft.path)); show();
          });
          row.append(recover, save, discard); get('draftList').append(row);
        }
      });
      get('draftError').textContent = '';
      if (!get('draftDialog').open) get('draftDialog').showModal();
    }
    A.events.on('document:changed', changed);
    A.events.on('workspace:willChange', flush);
    A.events.on('workspace:changed', update);
    A.events.on('file:opened', () => { update(); });
    A.events.on('file:closed', path => { guarded(() => store.remove(scope(), path)); pending.delete(JSON.stringify([A.state.root, A.state.currentBranch, path])); update(); });
    root.addEventListener('pagehide', flush); root.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    get('draftsButton').addEventListener('click', show); get('draftClose').addEventListener('click', () => get('draftDialog').close());
    return { flush, update, show };
  }
  root.DitaDrafts = { createDraftController };
})(window);
