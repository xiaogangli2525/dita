'use strict';
(function (root) {
  function createController(A, { reloadWorkspace, loadRepositories, openManual }) {
    const get = id => document.getElementById(id);
    let busy = false, checked = null, importWorkspace = '';
    const dirty = () => Array.from(A.state.filesMap.values()).some(file => file.dirty);
    const supported = () => A.state.capabilities.remoteGit === true;
    function message(id, text = '') { get(id).textContent = text; }
    function sync() {
      for (const id of ['remoteImportButton', 'remoteUpdateButton']) { get(id).disabled = busy || !supported(); get(id).title = supported() ? '' : '远程 Git 需要运行本地服务；在线演示不支持远程仓库'; }
      get('remotePullButton').disabled = busy || !checked || checked.dirty || dirty() || checked.ahead > 0 || checked.behind < 1;
    }
    async function request(url, body) {
      const response = await A.api.request(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await A.api.error(response)); return response.json();
    }
    function protect() { if (dirty()) throw new Error('当前有未保存的编辑内容，请先保存，再加载仓库或拉取更新'); }
    async function run(errorId, action) {
      if (busy) return; busy = true; message(errorId);
      const controls = () => [...get('remoteImportDialog').querySelectorAll('input,select,button'), ...get('remoteUpdateDialog').querySelectorAll('input,select,button')];
      controls().forEach(el => { el.disabled = true; }); sync();
      try { await action(); }
      catch (error) { checked = null; message(errorId, error.message); message(errorId === 'remoteImportError' ? 'remoteImportStatus' : 'remoteUpdateStatus', '操作未完成，可处理错误后重试'); A.setStatus(error.message, true); }
      finally { busy = false; controls().forEach(el => { el.disabled = false; }); sync(); }
    }
    async function choose(workspace, previous = '') {
      if (previous && workspace.maps.some(map => map.path === previous)) { await openManual(previous); return; }
      get('remoteManual').replaceChildren(); for (const map of workspace.maps) get('remoteManual').add(new Option((map.title || map.name) + ' · ' + map.path, map.path));
      if (workspace.maps.length) get('remoteManualDialog').showModal(); else A.setStatus('仓库已加载，未发现 .ditamap；可从文档导航选择 Topic');
    }
    get('remoteImportButton').addEventListener('click', () => {
      if (busy || !supported()) return; importWorkspace = A.api.token; get('remoteImportForm').reset(); get('remoteBranch').replaceChildren(new Option('默认分支', ''));
      message('remoteImportError'); message('remoteImportStatus'); get('remoteImportDialog').showModal();
    });
    get('remoteUrl').addEventListener('input', () => { get('remoteBranch').replaceChildren(new Option('默认分支', '')); message('remoteImportStatus'); });
    get('remoteBranchesButton').addEventListener('click', () => run('remoteImportError', async () => {
      if (importWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开加载窗口');
      message('remoteImportStatus', '正在读取远程分支…'); const result = await request('/api/remotes/branches', { url: get('remoteUrl').value.trim() });
      get('remoteBranch').replaceChildren(new Option('默认分支', '')); for (const name of result.branches) get('remoteBranch').add(new Option(name, name));
      if (result.defaultBranch) get('remoteBranch').value = result.defaultBranch; message('remoteImportStatus', result.branches.length + ' 个远程分支');
    }));
    get('remoteImportForm').addEventListener('submit', event => {
      event.preventDefault(); run('remoteImportError', async () => {
        protect(); if (importWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开加载窗口');
        message('remoteImportStatus', '正在克隆文档库，请稍候…');
        const result = await request('/api/remotes/clone', { url: get('remoteUrl').value.trim(), name: get('remoteName').value.trim(), branch: get('remoteBranch').value });
        await loadRepositories(); if (dirty()) throw new Error('仓库已克隆，但编辑区出现未保存修改。请先保存，再从仓库列表切换');
        const workspace = await request('/api/repository', { repository: result.path }); await reloadWorkspace(workspace); get('remoteImportDialog').close();
        A.setStatus('远程文档库已加载：' + result.name); await choose(workspace);
      });
    });
    function draw(status) {
      message('remoteRepositoryInfo', status.available ? status.url + '\n分支：' + status.branch + ' → origin/' + status.upstreamBranch + '\n本地提交：' + status.head.slice(0, 8) : status.message);
      if (!status.available) return;
      const notes = [status.remoteHead ? '本地领先 ' + status.ahead + ' 个提交，远程领先 ' + status.behind + ' 个提交' : '点击“检查远程更新”读取远程最新版本'];
      if (status.dirty) notes.push('Git 工作区有改动，需先提交或暂存'); if (dirty()) notes.push('编辑区有未保存内容，需先保存');
      if (status.ahead && status.behind) notes.push('历史已分叉，请在 Git 中处理'); message('remoteUpdateStatus', notes.join('；'));
    }
    get('remoteUpdateButton').addEventListener('click', () => {
      if (busy || !supported()) return; checked = null; message('remoteUpdateError'); message('remoteUpdateStatus', '正在读取仓库信息…'); get('remoteUpdateDialog').showModal(); run('remoteUpdateError', async () => draw(await request('/api/remote')));
    });
    get('remoteCheckButton').addEventListener('click', () => run('remoteUpdateError', async () => { checked = null; message('remoteUpdateStatus', '正在检查远程更新…'); checked = await request('/api/remote/check', {}); draw(checked); }));
    get('remotePullButton').addEventListener('click', () => run('remoteUpdateError', async () => {
      protect(); if (!checked) throw new Error('请先检查远程更新'); const previous = A.state.activePath, expected = checked; checked = null;
      message('remoteUpdateStatus', '正在重新核对并拉取更新…'); const result = await request('/api/remote/update', { expectedHead: expected.head, expectedRemoteHead: expected.remoteHead });
      if (!result.updated) { draw(result.info); return; }
      await reloadWorkspace(result.workspace); get('remoteUpdateDialog').close(); await choose(result.workspace, previous); A.setStatus('已快进更新到远程版本；文档已重新加载');
    }));
    for (const prefix of ['remoteImport', 'remoteUpdate']) { get(prefix + 'Cancel').addEventListener('click', () => { if (!busy) get(prefix + 'Dialog').close(); }); get(prefix + 'Dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); }); }
    get('remoteManualCancel').addEventListener('click', () => get('remoteManualDialog').close());
    get('remoteManualForm').addEventListener('submit', async event => { event.preventDefault(); get('remoteManualDialog').close(); try { await openManual(get('remoteManual').value); } catch (error) { A.setStatus(error.message, true); } });
    A.events.on('document:changed', () => { if (checked) draw(checked); sync(); });
    A.events.on('workspace:willChange', () => { checked = null; for (const id of ['remoteUpdateDialog', 'remoteImportDialog', 'remoteManualDialog']) get(id).close(); });
    A.events.on('workspace:changed', sync); sync(); return {};
  }
  root.DitaRemoteLibraries = { createController };
})(window);
