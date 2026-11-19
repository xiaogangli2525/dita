// @ts-check
'use strict';
(function (root) {
  /** @param {import('../data-contracts').GitCommitPorts} A */
  function createController(A) {
    /** @param {string} id */
    const get = id => document.getElementById(id);
    const dialog = /** @type {HTMLDialogElement} */ (get('gitCommitDialog'));
    const open = /** @type {HTMLButtonElement} */ (get('gitCommitButton'));
    const message = /** @type {HTMLTextAreaElement} */ (get('gitCommitMessage'));
    const submit = /** @type {HTMLButtonElement} */ (get('gitCommitSubmit'));
    const list = /** @type {HTMLDivElement} */ (get('gitCommitList'));
    /** @type {import('../data-contracts').GitCommitPlan | null} */
    let plan = null;
    let busy = false;
    /** @param {string} id @param {string} text */
    const tell = (id, text) => { const target = get(id); if (target) target.textContent = text; };
    const selected = () => new Set(Array.from(list.querySelectorAll('input:checked'), node => /** @type {HTMLInputElement} */ (node).value));
    function sync() {
      open.disabled = !A.state.capabilities.gitWrites;
      submit.disabled = busy || !plan || !selected().size;
      message.disabled = busy;
      list.querySelectorAll('input').forEach(node => { node.disabled = busy || A.state.filesMap.get(node.value)?.dirty === true; });
    }
    /** @param {string} url @param {object} [body] */
    async function request(url, body) {
      const response = await A.api.request(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
      if (!response.ok) throw Error(await A.api.error(response));
      return response.json();
    }
    function draw() {
      list.replaceChildren();
      for (const file of plan?.files || []) {
        const label = document.createElement('label');
        label.className = 'git-commit-file';
        if (file.oid) {
          const input = document.createElement('input'); input.type = 'checkbox'; input.value = file.path;
          label.append(input);
        }
        label.append(document.createTextNode(file.path + (file.reason ? ' · ' + file.reason : '')));
        list.append(label);
      }
      tell('gitCommitStatus', plan?.files.length ? plan.branch + ' · 核对已保存内容后勾选' : '没有可核对的已跟踪文档改动。');
    }
    open.addEventListener('click', async () => {
      if (busy || open.disabled) return;
      const token = A.api.token; busy = true; plan = null; list.replaceChildren(); message.value = '';
      tell('gitCommitError', ''); tell('gitCommitStatus', '正在读取已保存的文档改动…');
      dialog.showModal(); sync();
      try {
        const result = await request('/api/git/commit');
        if (token === A.api.token && dialog.open) { plan = result; draw(); }
      } catch (error) { if (token === A.api.token) tell('gitCommitError', /** @type {Error} */ (error).message); }
      finally { busy = false; sync(); }
    });
    get('gitCommitForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !plan) return;
      const paths = selected(), files = plan.files.filter(file => paths.has(file.path) && file.oid);
      if (!files.length || files.some(file => A.state.filesMap.get(file.path)?.dirty)) { tell('gitCommitError', '请先保存选中文档，再核对提交范围。'); return; }
      const token = A.api.token; busy = true; tell('gitCommitError', ''); sync();
      try {
        const result = await request('/api/git/commit', { branch: plan.branch, head: plan.head, files, message: message.value });
        if (token !== A.api.token) return;
        const refreshed = await Promise.allSettled(files.map(async ({ path }) => {
          const file = A.state.filesMap.get(path);
          if (!file) return;
          const git = await request('/api/git?path=' + encodeURIComponent(path));
          if (!git.available) throw Error('无法读取提交基线');
          if (token === A.api.token && A.state.filesMap.get(path) === file) root.DitaDocumentStore.acknowledgeCommit(file, git);
        }));
        if (token !== A.api.token) return;
        A.refreshChrome();
        const status = '已在 ' + result.branch + ' 提交 ' + result.head.slice(0, 8) +
          (refreshed.some(value => value.status === 'rejected') ? '。部分审阅基线需重新打开文档。' : '');
        A.setStatus(status); tell('gitCommitStatus', status); list.replaceChildren(); plan = null;
      } catch (error) { if (token === A.api.token) tell('gitCommitError', /** @type {Error} */ (error).message); }
      finally { busy = false; sync(); }
    });
    list.addEventListener('change', sync);
    get('gitCommitClose')?.addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    A.events.on('workspace:willChange', () => { plan = null; dialog.close(); });
    A.events.on('workspace:changed', sync);
    A.events.on('document:changed', sync);
    sync();
    return {};
  }
  root.DitaGitCommit = { createController };
})(window);
