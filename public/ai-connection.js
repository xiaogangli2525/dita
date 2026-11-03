'use strict';
(function (root) {
  function createController({ api, changed, pending }) {
    const get = id => document.getElementById(id);
    let config = null, saving = false;
    function show(value) {
      config = value;
      get('aiConnectionFields').disabled = value.editable === false;
      get('aiBaseUrl').value = value.baseUrl || '';
      get('aiConnectionModel').value = value.model || '';
      get('aiKey').value = ''; get('aiKey').placeholder = value.keyConfigured ? '已配置；留空保留当前接口的 Key' : '本机无鉴权服务可留空';
      get('aiAllowHttp').checked = Boolean(value.allowHttp); get('aiNoAuth').checked = Boolean(value.noAuth);
      get('aiConnectionHint').textContent = value.editable === false ? '演示模式不连接模型。' : '连接配置仅在本次服务运行期间生效，Key 不会保存在浏览器。';
    }
    async function save() {
      const button = get('aiConnectionSave'); button.disabled = true;
      // Read before disabling/clearing fields so this request has a stable input.
      const input = { baseUrl: get('aiBaseUrl').value, model: get('aiConnectionModel').value, key: get('aiKey').value,
        allowHttp: get('aiAllowHttp').checked, noAuth: get('aiNoAuth').checked };
      saving = true; pending();
      try {
        const response = await api.request('/api/ai/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
        if (!response.ok) throw Error(await api.error(response));
        const value = await response.json(); show(value); changed(value); get('aiConnectionHint').textContent = '连接配置已更新。点击“生成修改建议”时才会发送选定内容。';
      } catch (error) { get('aiConnectionHint').textContent = error.message; }
      finally { get('aiKey').value = ''; button.disabled = false; saving = false; pending(); }
    }
    get('aiConnectionSave').addEventListener('click', save);
    function clearKey() { get('aiKey').value = ''; }
    return { show, clearKey, get saving() { return saving; }, get editable() { return config?.editable !== false; } };
  }
  root.DitaAiConnection = { createController };
})(window);
