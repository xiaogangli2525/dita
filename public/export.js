'use strict';

// Export functions — loaded before app.js.  Accesses shared state via window.DitaApp.
(function () {
  const A = window.DitaApp = window.DitaApp || {};

  const topicCache = new Map();

  A.clearTopicCache = function () { topicCache.clear(); };

  A.loadTopicFiles = async function (map) {
    const { ditaCore } = A;
    const entries = ditaCore.collectPreviewPaths(map.children || []);
    const files = new Map();
    const failures = [];
    await Promise.all(entries.map(async entry => {
      try {
        let content;
        if (topicCache.has(entry.path)) {
          content = await topicCache.get(entry.path);
        } else {
          const promise = fetch('/api/file?path=' + encodeURIComponent(entry.path))
            .then(resp => { if (!resp.ok) throw new Error('fetch failed'); return resp.text(); });
          topicCache.set(entry.path, promise);
          content = await promise;
        }
        files.set(entry.path, { path: entry.path, current: content });
      } catch (error) {
        topicCache.delete(entry.path);
        failures.push({ path: entry.path, error: error.message });
      }
    }));
    return { files, failures };
  };

  A.toggleExportMenu = function () {
    const { dom } = A;
    if (!dom.exportMenu) return;
    const open = dom.exportMenu.hasAttribute('hidden');
    if (open) { dom.exportMenu.hidden = false; dom.exportMenuButton.setAttribute('aria-expanded', 'true'); }
    else { dom.exportMenu.hidden = true; dom.exportMenuButton.setAttribute('aria-expanded', 'false'); }
  };

  A.closeExportMenu = function () {
    const { dom } = A;
    if (!dom.exportMenu) return;
    dom.exportMenu.hidden = true;
    dom.exportMenuButton?.setAttribute('aria-expanded', 'false');
  };

  A.browserLoadImageBytes = async function (path) {
    const resp = await fetch('/api/asset?path=' + encodeURIComponent(path));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  A.previewMapHtml = async function () {
    const { state, dom, ditaCore, setStatus, loadTopicFiles, browserLoadImageBytes } = A;
    const file = state.filesMap.get(state.activePath);
    if (!file) return;
    if (!/\.ditamap$/i.test(file.path)) { setStatus('HTML 预览仅支持 Map 文件', true); return; }
    const map = state.maps.find(m => m.path === file.path);
    if (!map) { setStatus('无法找到 Map 对象', true); return; }
    try {
      const { files, failures } = await loadTopicFiles(map);
      if (failures.length) setStatus(failures.length + ' 个 topic 加载失败', true);
      const html = await ditaCore.exportMapToHtml({ map, files, title: map.title || map.name, loadImageBytes: browserLoadImageBytes });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      dom.htmlPreviewFrame.src = url;
      dom.mdPreviewPane?.classList.remove('active');
      dom.visualPane.classList.remove('active');
      dom.htmlPreviewPane.classList.add('active');
    } catch (error) {
      setStatus('HTML 预览失败：' + error.message, true);
    }
  };

  A.exportMapToHtmlFile = async function () {
    const { state, ditaCore, setStatus, loadTopicFiles } = A;
    const file = state.filesMap.get(state.activePath);
    if (!file) return;
    if (!/\.ditamap$/i.test(file.path)) { setStatus('导出 HTML 仅支持 Map 文件', true); return; }
    const map = state.maps.find(m => m.path === file.path);
    if (!map) { setStatus('无法找到 Map 对象', true); return; }
    try {
      const { files, failures } = await loadTopicFiles(map);
      if (failures.length) setStatus(failures.length + ' 个 topic 加载失败', true);
      const html = await ditaCore.exportMapToHtml({ map, files, title: map.title || map.name });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.path.replace(/\.ditamap$/i, '.html');
      link.click();
      URL.revokeObjectURL(url);
      setStatus('HTML 导出成功');
    } catch (error) {
      setStatus('HTML 导出失败：' + error.message, true);
    }
  };

  A.previewMapMd = async function () {
    const { state, dom, ditaCore, setStatus, loadTopicFiles } = A;
    const file = state.filesMap.get(state.activePath);
    if (!file) return;
    if (!/\.ditamap$/i.test(file.path)) { setStatus('Markdown 预览仅支持 Map 文件', true); return; }
    const map = state.maps.find(m => m.path === file.path);
    if (!map) { setStatus('无法找到 Map 对象', true); return; }
    try {
      const { files, failures } = await loadTopicFiles(map);
      if (failures.length) setStatus(failures.length + ' 个 topic 加载失败', true);
      const md = await ditaCore.exportMapToMarkdown({ map, files, title: map.title || map.name });
      dom.mdPreviewContent.innerHTML = ditaCore.highlightMarkdown(md);
      dom.htmlPreviewPane?.classList.remove('active');
      dom.visualPane.classList.remove('active');
      dom.mdPreviewPane.classList.add('active');
    } catch (error) {
      setStatus('Markdown 预览失败：' + error.message, true);
    }
  };

  A.exportMapToMarkdownFile = async function () {
    const { state, ditaCore, setStatus, loadTopicFiles, browserLoadImageBytes } = A;
    const file = state.filesMap.get(state.activePath);
    if (!file) return;
    if (!/\.ditamap$/i.test(file.path)) { setStatus('导出 Markdown 仅支持 Map 文件', true); return; }
    const map = state.maps.find(m => m.path === file.path);
    if (!map) { setStatus('无法找到 Map 对象', true); return; }
    try {
      const { files, failures } = await loadTopicFiles(map);
      if (failures.length) setStatus(failures.length + ' 个 topic 加载失败', true);
      const md = await ditaCore.exportMapToMarkdown({ map, files, title: map.title || map.name, loadImageBytes: browserLoadImageBytes });
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.path.replace(/\.ditamap$/i, '.md');
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Markdown 导出成功');
    } catch (error) {
      setStatus('Markdown 导出失败：' + error.message, true);
    }
  };
})();
