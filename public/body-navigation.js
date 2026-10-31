'use strict';
(function (root) {
  function createController(A) {
    let previous = null, lastWriting = null;
    const button = document.getElementById('returnWritingPosition');
    function surface(path) { return A.state.activePath === path ? A.dom.visualEditor : Array.from(A.dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === path); }
    function record() {
      const selected = root.getSelection(), node = selected?.anchorNode, element = node?.nodeType === 1 ? node : node?.parentElement;
      if (!node || !A.dom.visualEditor.contains(node)) return;
      const current = element?.closest('.map-topic-surface') || A.dom.visualEditor;
      lastWriting = { active: A.state.activePath, mode: A.state.mode, path: current.dataset.mapTopicPath || A.state.activePath, bookmark: A.authorSelection.bookmark(current), scroll: A.dom.visualEditor.scrollTop, workspace: A.api.token };
    }
    document.addEventListener('selectionchange', record);
    function remember() {
      record();
      previous = lastWriting && lastWriting.workspace === A.api.token && lastWriting.active === A.state.activePath ? lastWriting : { active: A.state.activePath, path: A.state.activePath, mode: A.state.mode, scroll: A.dom.visualEditor.scrollTop, workspace: A.api.token };
      button.hidden = !previous.active;
    }
    async function prepare(path, expectedSource) {
      const workspace = A.api.token; remember();
      if (!surface(path) || !['visual', 'preview'].includes(A.state.mode)) { await A.openFile(path, { preserveFootnotesScope: true }); A.setMode('visual'); }
      if (workspace !== A.api.token) throw new Error('工作区已切换');
      const file = A.state.filesMap.get(path), target = surface(path);
      if (!file || target?.ditaSourceContent !== file.current || expectedSource !== undefined && expectedSource !== file.current) throw new Error('正文已变化，请刷新后重新定位');
      return { file, target };
    }
    function highlight(target, node) {
      A.dom.visualEditor.querySelectorAll('.footnote-located').forEach(item => item.classList.remove('footnote-located'));
      node.classList.add('footnote-located'); node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    async function node(path, xmlPath, expectedSource) {
      const { target } = await prepare(path, expectedSource), match = Array.from(target.querySelectorAll('*')).find(item => item.ditaSourcePath === xmlPath);
      if (!match) throw new Error('此内容未显示在正文中，可使用源码定位');
      highlight(target, match.closest('p,td,th,li') || match);
      A.setStatus('已定位正文 · ' + path);
    }
    async function hit(path, start, end, expected) {
      const { file, target } = await prepare(path);
      if (file.current.slice(start, end) !== expected) throw new Error('正文已变化，请重新搜索');
      const tree = root.DitaXmlSource.inspectSource(file.current), candidates = [];
      function visit(item, xmlPath) {
        if (item.start > start || (item.close?.end ?? item.end) < start) return;
        if (item.kind === 'element') { candidates.push({ item, xmlPath }); item.children.filter(child => child.kind === 'element').forEach((child, index) => visit(child, xmlPath ? xmlPath + '/' + index : String(index))); }
      }
      visit(tree, '');
      const chosen = candidates.reverse().map(candidate => ({ ...candidate, node: Array.from(target.querySelectorAll('*')).find(node => node.ditaSourcePath === candidate.xmlPath) })).find(candidate => candidate.node);
      if (!chosen) throw new Error('此内容未显示在正文中，可使用源码定位');
      highlight(target, chosen.node);
      const prefix = file.current.slice(chosen.item.end, start), wanted = root.DitaManualCore.decode(expected.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
      const offset = root.DitaManualCore.decode(prefix.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').length;
      if (wanted && chosen.node.textContent.slice(offset, offset + wanted.length) === wanted) A.authorSelection.focus(target, chosen.xmlPath, offset, offset + wanted.length);
      A.setStatus('已定位正文 · ' + path);
    }
    button.addEventListener('click', async () => {
      const saved = previous; if (!saved || saved.workspace !== A.api.token) return;
      try {
        if (A.state.activePath !== saved.active) await A.openFile(saved.active, { preserveFootnotesScope: true });
        if (A.state.mode !== saved.mode) A.setMode(saved.mode);
        // Map loading is asynchronous. Wait for its source surface to mount.
        for (let i = 0; i < 50 && !surface(saved.path); i++) await new Promise(resolve => setTimeout(resolve, 20));
        if (saved.workspace !== A.api.token) return;
        A.authorSelection.restore(surface(saved.path), saved.bookmark); A.dom.visualEditor.scrollTop = saved.scroll; previous = null; button.hidden = true;
      } catch (error) { A.setStatus(error.message, true); }
    });
    A.events.on('workspace:willChange', () => { previous = lastWriting = null; button.hidden = true; });
    return { node, hit };
  }
  root.DitaBodyNavigation = { createController };
})(window);
