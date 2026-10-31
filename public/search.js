'use strict';
(function (root) {
  function createSearchController(A) {
    const get = id => document.getElementById(id);
    let generation = 0, timer;
    async function search() {
      const query = get('contentSearchInput').value.trim(), current = ++generation, workspace = A.api.token;
      const list = get('contentSearchResults'); list.replaceChildren();
      if (!query) { get('contentSearchMeta').textContent = '搜索当前功能手册或整个仓库的正文。'; return; }
      get('contentSearchMeta').textContent = '正在搜索…';
      try {
        let paths;
        if (get('contentSearchScope').value === 'manual') { const snapshot = await A.manual.capture(A.manual.scopePath()); paths = [snapshot.path, ...snapshot.files.keys()]; }
        const buffers = new Map(Array.from(A.state.filesMap).filter(([, file]) => file.dirty && (!paths || paths.includes(file.path))).map(([path, file]) => [path, file.current]));
        const response = await A.api.request('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, paths }) });
        if (!response.ok) throw new Error(await A.api.error(response));
        const result = await response.json(), matches = result.matches.filter(match => !buffers.has(match.path)), warnings = result.warnings || [];
        for (const [path, source] of buffers) {
          try { matches.push(...root.DitaSearchCore.findMatches(source, query).map(match => ({ path, ...match }))); }
          catch (error) { warnings.push({ path, message: error.message }); }
        }
        if (current !== generation || workspace !== A.api.token) return;
        const hits = matches.sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start).slice(0, 100);
        get('contentSearchMeta').textContent = `${hits.length} 个结果 · 包含未保存修改` + (result.truncated || matches.length > 100 ? ' · 已达搜索上限，请缩小范围' : '') + (warnings.length ? ` · ${warnings.length} 个文件无法搜索` : '');
        for (const hit of hits) {
          const button = document.createElement('button'), title = document.createElement('strong'), excerpt = document.createElement('span');
          button.type = 'button'; button.className = 'content-search-result'; title.textContent = hit.path + ':' + hit.line; excerpt.textContent = hit.excerpt;
          button.append(title, excerpt); button.addEventListener('click', async () => {
            try { await A.bodyNavigation.hit(hit.path, hit.start, hit.end, hit.matchedSource); }
            catch (error) { get('contentSearchMeta').textContent = error.message + '，请重新搜索'; }
          });
          const source = document.createElement('button'); source.type = 'button'; source.className = 'search-source-action'; source.textContent = '源码'; source.title = '在源码中定位';
          source.addEventListener('click', async () => { try { await A.navigateToSource(hit.path, hit.start, hit.end, hit.matchedSource); } catch (error) { get('contentSearchMeta').textContent = error.message; } });
          const row = document.createElement('div'); row.className = 'search-result-row'; row.append(button, source); list.append(row);
        }
        for (const warning of warnings.slice(0, 10)) { const item = document.createElement('p'); item.textContent = warning.path + '：' + warning.message; list.append(item); }
      } catch (error) { if (current === generation) get('contentSearchMeta').textContent = error.message; }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(search, 300); }
    get('contentSearchInput').addEventListener('input', schedule); get('contentSearchScope').addEventListener('change', search); get('contentSearchButton').addEventListener('click', search);
    A.events.on('workspace:changed', () => { generation++; get('contentSearchResults').replaceChildren(); get('contentSearchMeta').textContent = '搜索当前功能手册或整个仓库的正文。'; });
    A.events.on('document:changed', () => { if (A.state.activeView === 'search' && get('contentSearchInput').value.trim()) schedule(); });
    return { search };
  }
  root.DitaSearch = { createSearchController };
})(window);
