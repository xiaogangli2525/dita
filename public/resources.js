'use strict';
(function (root) {
  function createResourceController(A) {
    const get = id => document.getElementById(id), xml = root.DitaXmlSource;
    const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    let snapshot = null, targets = [], loadGeneration = 0;
    function capture() {
      if (!['visual', 'editor'].includes(A.state.mode)) throw new Error('请先切换到编写或源码模式');
      const selection = root.getSelection(), anchor = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode : selection?.anchorNode?.parentElement;
      const selected = anchor && A.dom.visualEditor.contains(anchor) ? anchor.closest('p,td,li,pre') : A.state.selectedVisualElement;
      let path = A.state.activePath;
      if (/\.ditamap$/i.test(path)) path = selected?.closest('[data-map-topic-path]')?.dataset.mapTopicPath;
      const file = A.state.filesMap.get(path);
      if (!file || /\.ditamap$/i.test(path)) throw new Error('请打开一个 Topic，或先选择手册中的正文段落');
      const tree = xml.inspectSource(file.current);
      const body = tree.children.find(node => node.kind === 'element' && ['body', 'conbody', 'refbody', 'taskbody'].includes(node.name));
      if (!body?.close) throw new Error('当前文档没有可插入的正文');
      let start = body.close.start, end = start, inline = false, label = '正文末尾';
      if (A.state.mode === 'editor') {
        const a = A.dom.editor.selectionStart, b = A.dom.editor.selectionEnd;
        if (a >= body.end && b <= body.close.start) { start = a; end = b; inline = true; label = '当前光标位置'; }
      } else if (selected?.ditaSourcePath) {
        const node = selected.ditaSourcePath.split('/').filter(Boolean).reduce((node, index) => node.children.filter(child => child.kind === 'element')[Number(index)], tree);
        if (node?.close && ['p', 'entry', 'li'].includes(node.name)) { start = node.close.start; end = start; inline = true; label = '所选段落末尾'; }
      }
      return { path, current: file.current, start, end, inline, label, workspace: A.api.token, activePath: A.state.activePath };
    }
    function draw() {
      const query = get('resourceFilter').value.trim().toLowerCase(), select = get('resourceTarget'); select.replaceChildren();
      for (const [index, target] of targets.entries()) if (!query || target.label.toLowerCase().includes(query)) {
        const option = document.createElement('option'); option.value = String(index); option.textContent = target.label; select.append(option);
      }
    }
    async function load() {
      const workspace = snapshot.workspace, kind = get('resourceKind').value, generation = ++loadGeneration, active = snapshot;
      let nextTargets = []; get('resourceTarget').replaceChildren();
      if (kind === 'image') {
        const response = await A.api.request('/api/assets'); if (!response.ok) throw new Error(await A.api.error(response));
        const result = await response.json(); nextTargets = result.files.map(path => ({ path, label: path }));
        get('resourceMessage').textContent = result.truncated ? '图片列表已达上限，请缩小仓库范围。' : '选择已有图片，或上传到当前仓库的 assets 目录。';
      } else {
        const manual = await A.manual.capture(A.manual.scopePath()); nextTargets = [];
        for (const entry of A.ditaCore.collectPreviewPaths(manual.map.children)) {
          const doc = A.ditaCore.parseXml(manual.files.get(entry.path).current), topic = doc.documentElement, topicId = topic.getAttribute('id');
          if (!topicId) continue;
          nextTargets.push({ path: entry.path, fragment: topicId, label: entry.path + ' · ' + (doc.querySelector('title')?.textContent || topicId) });
          for (const section of doc.querySelectorAll('section')) if (section.getAttribute('id')) nextTargets.push({ path: entry.path, fragment: topicId + '/' + section.getAttribute('id'), label: entry.path + ' · ' + (section.querySelector('title')?.textContent || section.getAttribute('id')) });
        }
        get('resourceMessage').textContent = '链接目标来自当前功能手册的 Topic 和章节。';
      }
      if (generation !== loadGeneration || snapshot !== active || kind !== get('resourceKind').value) return;
      if (workspace !== A.api.token || !snapshot) throw new Error('工作区已切换，请重新打开资源选择器');
      targets = nextTargets; get('resourceUploadRow').hidden = kind !== 'image'; draw();
    }
    async function show(kind = 'image') {
      try {
        snapshot = capture(); get('resourceKind').value = kind; get('resourceFilter').value = ''; get('resourceLabel').value = '';
        get('resourceError').textContent = ''; get('resourceScope').textContent = snapshot.path + ' · ' + snapshot.label;
        get('resourceDialog').showModal(); await load();
      } catch (error) { if (get('resourceDialog').open) get('resourceError').textContent = error.message; else A.setStatus(error.message, true); }
    }
    get('resourceKind').addEventListener('change', () => load().catch(error => { get('resourceError').textContent = error.message; }));
    get('resourceFilter').addEventListener('input', draw); get('resourceClose').addEventListener('click', () => get('resourceDialog').close());
    get('resourceUpload').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('图片请限制在 2 MiB 以内');
        if (!snapshot || snapshot.workspace !== A.api.token) throw new Error('工作区已切换');
        const bytes = new Uint8Array(await file.arrayBuffer()); root.DitaAssetCore.validateImage(file.name, bytes); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        const response = await A.api.request('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, base64: root.btoa(binary) }) });
        if (!response.ok) throw new Error(await A.api.error(response));
        const result = await response.json(); await load();
        get('resourceTarget').value = String(targets.findIndex(target => target.path === result.path));
        get('resourceMessage').textContent = '图片已添加到仓库；应用后插入相对路径，尚未提交 Git。';
      } catch (error) { get('resourceError').textContent = error.message; }
      finally { event.target.value = ''; }
    });
    get('resourceForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const target = targets[Number(get('resourceTarget').value)];
        if (!target || !get('resourceTarget').options.length) throw new Error('请先选择图片或链接目标');
        const file = A.state.filesMap.get(snapshot?.path);
        if (!file || snapshot.workspace !== A.api.token || file.current !== snapshot.current || snapshot.activePath !== A.state.activePath) throw new Error('内容已变化，请重新打开资源选择器');
        const href = root.DitaManualCore.relativeHref(snapshot.path, target.path, target.fragment);
        const kind = get('resourceKind').value, label = get('resourceLabel').value.trim() || target.label;
        let snippet = kind === 'image' ? '<image href="' + escape(href) + '" alt="' + escape(label) + '"/>' : '<xref href="' + escape(href) + '">' + escape(label) + '</xref>';
        if (!snapshot.inline && kind === 'link') snippet = '<p>' + snippet + '</p>';
        const content = file.current.slice(0, snapshot.start) + snippet + file.current.slice(snapshot.end);
        xml.validateXml(content); A.setFileContent(file, content); get('resourceDialog').close(); A.setStatus('已插入' + (kind === 'image' ? '图片' : '链接') + '，可撤销；保存后写入磁盘');
      } catch (error) { get('resourceError').textContent = error.message; }
    });
    return { show };
  }
  root.DitaResources = { createResourceController };
})(window);
