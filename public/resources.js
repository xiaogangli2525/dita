'use strict';
(function (root) {
  function createResourceController(A) {
    const get = id => document.getElementById(id), xml = root.DitaXmlSource;
    const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    let snapshot = null, targets = [], loadGeneration = 0;
    function setLabel(node, label) {
      if (node.textContent === label) return;
      if (node.querySelector('fn,foreign,[conref]')) throw new Error('说明包含受保护内容，请仅修改地址');
      const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT), texts = []; let text;
      while ((text = walker.nextNode())) texts.push(text);
      if (!texts.length) node.textContent = label; else texts.forEach((text, i) => { text.data = i === 0 ? label : ''; });
    }
    function hrefOf(target) { return target?.existing ? target.href : target ? root.DitaManualCore.relativeHref(snapshot.path, target.path, target.fragment) : ''; }
    function updatePreview() {
      const image = get('resourceKind').value === 'image', target = targets[Number(get('resourceTarget').value)], preview = get('resourcePreview');
      get('resourceDimensions').hidden = !image; get('resourceAddressRow').hidden = image;
      preview.hidden = true; preview.removeAttribute('src');
      if (image && snapshot && target) {
        const url = new URL(hrefOf(target), 'https://dita.invalid/' + snapshot.path);
        if (url.origin === 'https://dita.invalid') { preview.src = '/api/asset?path=' + encodeURIComponent(decodeURIComponent(url.pathname.slice(1))); preview.alt = get('resourceLabel').value; preview.hidden = false; }
      }
    }
    function updateTarget() { const target = targets[Number(get('resourceTarget').value)]; if (get('resourceKind').value === 'link') get('resourceHref').value = hrefOf(target); updatePreview(); }
    function capture() {
      if (!['visual', 'editor'].includes(A.state.mode)) throw new Error('请先切换到编写或源码模式');
      if (A.state.mode === 'visual') {
        const author = A.authorSelection.capture(), { copy, range } = A.authorSelection.clone(author);
        const block = A.authorSelection.validateRange(range, copy, { body: true });
        if (block.matches('pre,h2,h3,h4')) throw new Error('请在普通正文、列表或表格中放置光标');
        return { ...author, author: true, label: range.collapsed ? '当前光标位置' : '所选文字（图片插在选区之后，链接保留文字格式）' };
      }
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
      updateTarget();
    }
    async function load() {
      const workspace = snapshot.workspace, kind = get('resourceKind').value, generation = ++loadGeneration, active = snapshot;
      let nextTargets; get('resourceTarget').replaceChildren();
      if (kind === 'image') {
        const response = await A.api.request('/api/assets'); if (!response.ok) throw new Error(await A.api.error(response));
        const result = await response.json(); nextTargets = result.files.map(path => ({ path, label: path }));
        get('resourceMessage').textContent = result.truncated ? '图片列表已达上限，请缩小仓库范围。' : '选择已有图片，或上传到当前仓库的 assets 目录。';
      } else {
        let manual;
        try { manual = await A.manual.capture(A.manual.scopePath()); }
        catch (error) { if (!active.edit) throw error; get('resourceMessage').textContent = '可直接修改链接地址；选择功能手册后可浏览其章节。'; }
        nextTargets = [];
        if (manual) {
        for (const entry of A.ditaCore.collectPreviewPaths(manual.map.children)) {
          const doc = A.ditaCore.parseXml(manual.files.get(entry.path).current), topic = doc.documentElement, topicId = topic.getAttribute('id');
          if (!topicId) continue;
          nextTargets.push({ path: entry.path, fragment: topicId, label: entry.path + ' · ' + (doc.querySelector('title')?.textContent || topicId) });
          for (const section of doc.querySelectorAll('section')) if (section.getAttribute('id')) nextTargets.push({ path: entry.path, fragment: topicId + '/' + section.getAttribute('id'), label: entry.path + ' · ' + (section.querySelector('title')?.textContent || section.getAttribute('id')) });
        }
        get('resourceMessage').textContent = '链接目标来自当前功能手册的 Topic 和章节。';
        }
      }
      if (generation !== loadGeneration || snapshot !== active || kind !== get('resourceKind').value) return;
      if (workspace !== A.api.token || !snapshot) throw new Error('工作区已切换，请重新打开资源选择器');
      targets = snapshot.edit ? [{ existing: true, href: snapshot.edit.node.getAttribute('href') || '', label: '当前：' + (snapshot.edit.node.getAttribute('href') || '未设置地址') }, ...nextTargets] : nextTargets;
      get('resourceUploadRow').hidden = kind !== 'image'; draw();
    }
    async function show(kind = 'image', existing = null) {
      try {
        if (get('resourceDialog').open) return;
        if (existing) {
          const edit = A.authorCommands.capture(existing);
          if (!['image', 'xref'].includes(edit.node.localName) || edit.node.getAttribute('type') === 'fn') throw new Error('此元素请使用对应的注脚编辑工具');
          kind = edit.node.localName === 'image' ? 'image' : 'link';
          snapshot = { edit, path: edit.file.path, current: edit.current, activePath: A.state.activePath, workspace: A.api.token, author: true, label: '修改已有' + (kind === 'image' ? '图片' : '链接') };
        } else snapshot = capture();
        get('resourceHeading').textContent = snapshot.edit ? snapshot.label : '插入图片或链接';
        get('resourceKind').disabled = Boolean(snapshot.edit); get('resourceKind').value = kind; get('resourceFilter').value = '';
        const node = snapshot.edit?.node;
        get('resourceLabel').value = node ? kind === 'image' ? root.DitaAssetCore.imagePresentation(node).alt : node.textContent : kind === 'link' && snapshot.author ? snapshot.range.toString() : '';
        get('resourceWidth').value = node?.getAttribute('width') || ''; get('resourceHeight').value = node?.getAttribute('height') || '';
        get('resourceHref').value = ''; get('resourcePreview').hidden = true;
        get('resourceError').textContent = ''; get('resourceScope').textContent = snapshot.path + ' · ' + snapshot.label;
        get('resourceDialog').showModal(); await load();
      } catch (error) { if (get('resourceDialog').open) get('resourceError').textContent = error.message; else A.setStatus(error.message, true); }
    }
    get('resourceKind').addEventListener('change', () => load().catch(error => { get('resourceError').textContent = error.message; }));
    function cancel() {
      const target = snapshot; snapshot = null; loadGeneration++; get('resourceDialog').close();
      if (target?.author) try { if (target.edit) { if (target.edit.file.current === target.current) A.authorSelection.restore(target.edit.surface, target.edit.before); } else A.authorSelection.restoreTarget(target); } catch { /* A stale context is never restored over a newer buffer. */ }
    }
    get('resourceFilter').addEventListener('input', draw); get('resourceClose').addEventListener('click', cancel);
    get('resourceTarget').addEventListener('change', updateTarget);
    get('resourceDialog').addEventListener('cancel', event => { event.preventDefault(); cancel(); });
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
        updateTarget();
        get('resourceMessage').textContent = '图片已添加到仓库；应用后插入相对路径，尚未提交 Git。';
      } catch (error) { get('resourceError').textContent = error.message; }
      finally { event.target.value = ''; }
    });
    get('resourceForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const target = targets[Number(get('resourceTarget').value)];
        const kind = get('resourceKind').value;
        if (kind === 'image' && (!target || !get('resourceTarget').options.length)) throw new Error('请先选择图片');
        const file = A.state.filesMap.get(snapshot?.path);
        if (!file || snapshot.workspace !== A.api.token || file.current !== snapshot.current || snapshot.activePath !== A.state.activePath) throw new Error('内容已变化，请重新打开资源选择器');
        if (snapshot.author && A.state.mode !== 'visual' || !snapshot.author && A.state.mode !== 'editor') throw new Error('编辑模式已变化，请重新打开资源选择器');
        const href = kind === 'link' ? get('resourceHref').value.trim() : hrefOf(target);
        // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted input.
        if (!href || /[\u0000-\u001f\u007f\\]/.test(href) || href.startsWith('//') || /^(?!https?:|mailto:)[a-z][a-z\d+.-]*:/i.test(href)) throw new Error('请输入有效的文档相对地址、锚点或 HTTP / HTTPS / mailto 链接');
        const label = get('resourceLabel').value.trim() || (snapshot.edit ? '' : target?.label || href), dimensions = {};
        if (kind === 'image') for (const name of ['width', 'height']) {
          const value = get(name === 'width' ? 'resourceWidth' : 'resourceHeight').value.trim();
          if (value && value !== snapshot.edit?.node.getAttribute(name) && (!/^\d+(?:\.\d+)?(?:px|pt|pc|mm|cm|in|em|%)?$/.test(value) || parseFloat(value) <= 0)) throw new Error('图片尺寸请输入正数，例如 320、80mm 或 50%');
          dimensions[name] = value;
        }
        if (snapshot.edit) {
          const edited = snapshot.edit.node.cloneNode(true); edited.setAttribute('href', href);
          if (kind === 'image') {
            const alt = Array.from(edited.children).find(child => child.localName === 'alt');
            if (alt) setLabel(alt, label); else edited.setAttribute('alt', label);
            for (const [name, value] of Object.entries(dimensions)) { if (value) edited.setAttribute(name, value); else edited.removeAttribute(name); }
          } else {
            setLabel(edited, label);
            if (/^(?:https?:|mailto:)/i.test(href)) edited.setAttribute('scope', 'external');
            else if (edited.getAttribute('scope') === 'external') edited.removeAttribute('scope');
          }
          A.authorCommands.replace(snapshot.edit, edited); snapshot = null; loadGeneration++; get('resourceDialog').close(); A.setStatus('已修改' + (kind === 'image' ? '图片' : '链接') + '，可撤销；保存后写入工作区'); return;
        }
        if (snapshot.author) {
          const node = document.createElement(kind === 'image' ? 'img' : 'a'); node.setAttribute('data-dita-source', kind === 'image' ? 'image' : 'xref');
          if (kind === 'image') { node.setAttribute('data-dita-href', href); node.alt = label; for (const [name, value] of Object.entries(dimensions)) if (value) node.setAttribute(name, value); }
          else { node.setAttribute('href', href); if (/^(?:https?:|mailto:)/i.test(href)) node.setAttribute('scope', 'external'); node.textContent = label; }
          A.authorSelection.insertInline(snapshot, node, { collapse: kind === 'image', wrap: kind === 'link' });
          snapshot = null; loadGeneration++; get('resourceDialog').close(); A.setStatus('已在正文插入' + (kind === 'image' ? '图片' : '链接') + '，可撤销；保存后写入工作区'); return;
        }
        let snippet = kind === 'image' ? '<image href="' + escape(href) + '" alt="' + escape(label) + '"' + Object.entries(dimensions).filter(([, value]) => value).map(([name, value]) => ' ' + name + '="' + escape(value) + '"').join('') + '/>' : '<xref href="' + escape(href) + '"' + (/^(?:https?:|mailto:)/i.test(href) ? ' scope="external"' : '') + '>' + escape(label) + '</xref>';
        if (!snapshot.inline && kind === 'link') snippet = '<p>' + snippet + '</p>';
        const content = file.current.slice(0, snapshot.start) + snippet + file.current.slice(snapshot.end);
        xml.validateXml(content); A.setFileContent(file, content); get('resourceDialog').close(); A.setStatus('已插入' + (kind === 'image' ? '图片' : '链接') + '，可撤销；保存后写入磁盘');
      } catch (error) { get('resourceError').textContent = error.message; }
    });
    A.events.on('workspace:willChange', () => { snapshot = null; loadGeneration++; get('resourceDialog').close(); });
    A.dom.visualEditor.addEventListener('dblclick', event => { const node = event.target.closest('[data-dita-source="image"],[data-dita-source="xref"]'); if (node && !node.matches('.fn-ref') && A.state.mode === 'visual') { event.preventDefault(); show('image', node); } });
    return { show, edit: element => show('image', element) };
  }
  root.DitaResources = { createResourceController };
})(window);
