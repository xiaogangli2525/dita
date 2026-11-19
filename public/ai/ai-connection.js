'use strict';
(function (root) {
  function createController({ api, events, changed, pending }) {
    const get = id => document.getElementById(id), dialog = get('aiConnectionDialog');
    let config = null, saving = false, generation = 0, opener = null;
    function sync(value) { config = value; }
    function draw(value) {
      sync(value); get('aiConnectionFields').disabled = value.editable === false;
      get('aiBaseUrl').value = value.baseUrl || ''; get('aiConnectionModel').value = value.model || '';
      get('aiKey').value = ''; get('aiKey').placeholder = value.keyConfigured ? '已配置；留空保留当前接口的 Key' : '本机无鉴权服务可留空';
      get('aiAllowHttp').checked = Boolean(value.allowHttp); get('aiNoAuth').checked = Boolean(value.noAuth);
      get('aiConnectionHint').textContent = value.editable === false ? '演示模式不连接模型。' : value.persisted ? '已保存到服务端用户配置，重启后仍可使用。' : '保存后在服务端用户配置中记住，Key 不会进入浏览器存储或文档仓库。';
    }
    async function open() {
      if (dialog.open || document.querySelector('dialog[open]:not(#aiDialog)')) return;
      opener = document.activeElement; dialog.showModal();
      get('aiConnectionFields').disabled = true; get('aiConnectionHint').textContent = '正在读取连接设置…';
      const id = ++generation;
      try {
        const response = await api.request('/api/ai/config'); if (!response.ok) throw Error(await api.error(response));
        const value = await response.json(); if (id !== generation || !dialog.open) return;
        draw(value); changed(value); get('aiBaseUrl').focus();
      } catch (error) { if (id === generation) get('aiConnectionHint').textContent = error.message; }
    }
    async function save() {
      if (saving) return;
      const input = { baseUrl: get('aiBaseUrl').value, model: get('aiConnectionModel').value, key: get('aiKey').value,
        allowHttp: get('aiAllowHttp').checked, noAuth: get('aiNoAuth').checked };
      const id = generation; saving = true; get('aiConnectionFields').disabled = true; get('aiConnectionClose').disabled = true; pending();
      try {
        const response = await api.request('/api/ai/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
        if (!response.ok) throw Error(await api.error(response));
        const value = await response.json(); if (id !== generation) return;
        draw(value); changed(value); get('aiConnectionHint').textContent = '连接已保存，重启后仍可使用。关闭设置即可继续写作。';
      } catch (error) { if (id === generation) get('aiConnectionHint').textContent = error.message; }
      finally {
        get('aiKey').value = ''; saving = false; get('aiConnectionClose').disabled = false;
        get('aiConnectionFields').disabled = config?.editable === false; pending();
      }
    }
    function close() {
      if (saving) return;
      generation++; get('aiKey').value = ''; dialog.close(); const previous = opener; opener = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    }
    get('aiConnectionSave').addEventListener('click', save); get('aiConnectionClose').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (!dialog.open && opener) close(); });
    events.on('workspace:willChange', () => { generation++; get('aiKey').value = ''; dialog.close(); opener = null; });
    return { open, sync, get saving() { return saving; } };
  }
  root.DitaAiConnection = { createController };
})(window);
