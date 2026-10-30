'use strict';
(function () {
  const A = window.DitaApp = window.DitaApp || {};
  // Only deduplicate in-flight reads. Completed disk reads must not outlive an
  // export; an external editor may change a file without notifying this client.
  const inFlight = new Map();
  let epoch = 0;
  let exporting = false;
  let previewUrl = '';
  A.clearTopicCache = function () { epoch++; inFlight.clear(); };
  A.releaseExportPreview = function () {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
  };
  window.addEventListener('beforeunload', A.releaseExportPreview);

  A.loadTopicFiles = async function (map, snapshot = A.state.filesMap) {
    const entries = A.ditaCore.collectPreviewPaths(map.children || []);
    const files = new Map();
    const failures = [];
    // Freeze buffers before awaiting IO, so a single export sees one revision.
    const buffers = new Map(Array.from(snapshot, ([path, file]) => [path, file.current]));
    await Promise.all(entries.map(async entry => {
      try {
        let content;
        if (buffers.has(entry.path)) content = buffers.get(entry.path);
        else {
          const key = `${A.api.token}:${epoch}:${entry.path}`;
          if (!inFlight.has(key)) {
            const promise = A.api.request('/api/file?path=' + encodeURIComponent(entry.path))
              .then(async response => {
                if (!response.ok) throw new Error(await A.api.error(response));
                return response.text();
              });
            inFlight.set(key, promise);
          }
          const promise = inFlight.get(key);
          try { content = await promise; }
          finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
        }
        files.set(entry.path, { path: entry.path, current: content });
      } catch (error) { failures.push({ path: entry.path, error: error.message }); }
    }));
    return { files, failures };
  };

  A.toggleExportMenu = function () {
    const { dom } = A;
    if (!dom.exportMenu) return;
    dom.exportMenu.hidden = !dom.exportMenu.hidden;
    dom.exportMenuButton.setAttribute('aria-expanded', String(!dom.exportMenu.hidden));
  };
  A.closeExportMenu = function () {
    if (!A.dom.exportMenu) return;
    A.dom.exportMenu.hidden = true;
    A.dom.exportMenuButton?.setAttribute('aria-expanded', 'false');
  };
  A.browserLoadImageBytes = async function (path) {
    const response = await A.api.request('/api/asset?path=' + encodeURIComponent(path));
    if (!response.ok) throw new Error(`图片加载失败：${path}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`图片读取失败：${path}`));
      reader.readAsDataURL(blob);
    });
  };

  async function runExport(format, preview) {
    if (exporting) return;
    const { state, dom, ditaCore, setStatus } = A;
    const file = state.filesMap.get(state.activePath);
    if (!file || !/\.ditamap$/i.test(file.path)) {
      setStatus('请先打开一个 Map 文档，再预览或导出', true);
      return;
    }
    const snapshot = new Map(Array.from(state.filesMap, ([path, item]) => [path, { path, current: item.current }]));
    const source = snapshot.get(file.path);
    const workspace = A.api.token;
    exporting = true;
    A.showLoading?.();
    try {
      const response = await A.api.request('/api/map/resolve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: source.path, content: source.current })
      });
      if (!response.ok) throw new Error(await A.api.error(response));
      const map = await response.json();
      const { files, failures } = await A.loadTopicFiles(map, snapshot);
      if (failures.length) throw new Error(`导出已停止，${failures.length} 个主题无法读取：${failures.map(item => item.path).join('、')}`);
      const imageFailures = [];
      const loadImageBytes = async path => {
        try { return await A.browserLoadImageBytes(path); }
        catch (error) { imageFailures.push(path); return null; }
      };
      const convert = format === 'html' ? ditaCore.exportMapToHtml : ditaCore.exportMapToMarkdown;
      // Validate every topic first. Core renderers may tolerate failures for
      // previews, but downloadable documents must not silently omit content.
      for (const item of files.values()) ditaCore.parseXml(item.current);
      const output = await convert({ map, files, title: map.title || map.name, loadImageBytes });
      if (workspace !== A.api.token) throw new Error('工作区已切换，请重新导出');
      if (imageFailures.length) throw new Error(`导出已停止，图片无法读取：${imageFailures.join('、')}`);
      if (preview) {
        if (state.activePath !== source.path) return;
        dom.editorPane.classList.remove('active');
        dom.visualPane.classList.remove('active');
        dom.previewPane.classList.remove('active');
        dom.htmlPreviewPane.classList.toggle('active', format === 'html');
        dom.mdPreviewPane.classList.toggle('active', format === 'md');
        if (format === 'html') {
          A.releaseExportPreview();
          previewUrl = URL.createObjectURL(new Blob([output], { type: 'text/html;charset=utf-8' }));
          dom.htmlPreviewFrame.src = previewUrl;
        } else dom.mdPreviewContent.innerHTML = ditaCore.highlightMarkdown(output);
        setStatus('预览已更新 · 包含当前未保存的修改');
      } else {
        const url = URL.createObjectURL(new Blob([output], { type: format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = source.path.split('/').pop().replace(/\.ditamap$/i, '.' + format);
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('导出成功 · 包含当前未保存的修改');
        A.toast?.('文档已导出', 'info');
      }
    } catch (error) {
      setStatus(error.message, true);
      A.toast?.(error.message, 'error');
    } finally { exporting = false; A.hideLoading?.(); }
  }
  A.previewMapHtml = () => runExport('html', true);
  A.exportMapToHtmlFile = () => runExport('html', false);
  A.previewMapMd = () => runExport('md', true);
  A.exportMapToMarkdownFile = () => runExport('md', false);
})();
