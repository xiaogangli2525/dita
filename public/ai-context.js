'use strict';
(function (root) {
  function createContext(A) {
    const core = root.DitaAiEditCore;
    function captureSelection() {
      if (A.state.mode === 'editor') {
        const file = A.state.filesMap.get(A.state.activePath), input = A.dom.editor;
        if (!file || input.selectionStart === input.selectionEnd) return null;
        return { path: file.path, source: file.current, ...core.target(file.current, input.selectionStart, input.selectionEnd) };
      }
      if (A.state.mode !== 'visual') return null;
      let target;
      try { target = A.authorSelection.capture(); } catch { return null; /* No Author caret is a valid state when opening the panel. */ }
      if (target.range.collapsed) return null;
      const block = A.authorSelection.validateRange(target.range, target.surface, { selected: true });
      const item = core.inspect(target.current).find(item => item.xmlPath === block.ditaSourcePath);
      if (!item) throw Error('此选区不能精确定位，请缩小选区或使用原文搜索');
      const text = target.range.toString();
      const matches = root.DitaSearchCore.findMatches(target.current.slice(item.start, item.end), text, 100);
      // A rendered repeated phrase cannot safely be mapped by text alone.
      if (matches.length !== 1) throw Error('选中文字在该段重复或包含特殊标记，请用原文搜索选择段落');
      const match = matches[0];
      return { path: target.path, source: target.current, ...core.target(target.current, item.start + match.start, item.start + match.end) };
    }
    function currentPath() {
      try { return A.authorSelection.capture().path; } catch { return A.state.activePath; /* Source mode or no caret uses the active Topic. */ }
    }
    async function locate(scope, query, path) {
      let snapshot, files;
      if (scope === 'manual') {
        snapshot = await A.manual.capture(A.manual.scopePath());
        files = Array.from(snapshot.files.values());
      } else {
        const file = A.state.filesMap.get(path);
        if (!file || /\.ditamap$/i.test(path)) throw Error('请在正文中选择章节，或将定位范围切换到当前功能手册');
        files = [file];
      }
      const hits = [], warnings = [];
      for (const file of files) {
        try { hits.push(...core.candidates(file.current, query).map(item => ({ ...item, path: file.path, source: file.current }))); }
        catch (error) { warnings.push(file.path + '：' + error.message); }
      }
      const sorted = hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.start - b.start);
      return { hits: sorted.slice(0, 30), truncated: sorted.length > 30, warnings, snapshot };
    }
    return { captureSelection, currentPath, locate };
  }
  root.DitaAiContext = { createContext };
})(window);
