'use strict';
(function (root) {
  const BLOCKS = 'p,li,td,th,pre,h2,h3,h4,[data-dita-source="note"],[data-dita-source="cmd"],[data-dita-source="dd"]';
  const PROTECTED = '[data-dita-source="fn"],[data-dita-source="foreign"],[conref],.oxy-delete,.oxy-insert,.oxy-comment';
  const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement;
  function textParts(range, container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), parts = []; let node;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.length;
      if (end > start) parts.push({ node, start, end });
    }
    return parts;
  }
  function createController(A) {
    let remembered = null, composing = false;
    const surfaceOf = node => elementOf(node)?.closest('.map-topic-surface') || A.dom.visualEditor;
    function remember() {
      if (A.state.mode !== 'visual' || composing || document.querySelector('dialog[open]')) return;
      const selection = root.getSelection(); if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!A.dom.visualEditor.contains(range.endContainer)) return;
      remembered = null;
      if (!A.dom.visualEditor.contains(range.startContainer) || surfaceOf(range.startContainer) !== surfaceOf(range.endContainer)) return;
      const surface = surfaceOf(range.endContainer), path = surface.dataset.mapTopicPath || A.state.activePath;
      const file = A.state.filesMap.get(path); if (!file || /\.ditamap$/i.test(path)) return;
      remembered = { range: range.cloneRange(), surface, file, path, activePath: A.state.activePath, workspace: A.api.token };
    }
    function connected(target) {
      return target && A.state.mode === 'visual' && target.activePath === A.state.activePath && target.workspace === A.api.token &&
        A.state.filesMap.get(target.path) === target.file && target.surface.isConnected &&
        target.surface.contains(target.range.startContainer) && target.surface.contains(target.range.endContainer);
    }
    function capture() {
      remember();
      if (composing || !connected(remembered)) throw new Error('请先在编写模式的正文中放置光标或选择文字');
      if (remembered.surface.ditaSourceContent !== remembered.file.current) throw new Error('正文已变化，请重新打开此 Topic 后操作');
      return { ...remembered, range: remembered.range.cloneRange(), current: remembered.file.current };
    }
    function check(target) {
      if (!connected(target) || target.current !== target.file.current || target.surface.ditaSourceContent !== target.current) throw new Error('正文或编写位置已变化，请重新选择');
    }
    function clone(target) {
      check(target);
      function address(node) {
        const indexes = [];
        while (node !== target.surface) { indexes.unshift(Array.from(node.parentNode.childNodes).indexOf(node)); node = node.parentNode; }
        return indexes;
      }
      const copy = target.surface.cloneNode(true);
      function metadata(from, to) {
        if (from.ditaSourcePath !== undefined) to.ditaSourcePath = from.ditaSourcePath;
        Array.from(from.childNodes).forEach((child, i) => metadata(child, to.childNodes[i]));
      }
      metadata(target.surface, copy);
      const point = node => address(node).reduce((parent, index) => parent.childNodes[index], copy);
      const range = document.createRange(); range.setStart(point(target.range.startContainer), target.range.startOffset); range.setEnd(point(target.range.endContainer), target.range.endOffset);
      return { copy, range };
    }
    function blockOf(node) { return elementOf(node)?.closest(BLOCKS); }
    function validateRange(range, surface, { selected = false, body = false, formatting = false } = {}) {
      const first = blockOf(range.startContainer), last = blockOf(range.endContainer);
      if (!first || first !== last || !surface.contains(first)) throw new Error('请在同一个段落、列表项或表格单元格中操作');
      if (body && !first.closest('[data-dita-body]')) throw new Error('请在正文中放置光标，不能在标题处插入');
      if (selected && range.collapsed) throw new Error('请先选中需要设置格式的文字');
      if (formatting && first.matches('pre')) throw new Error('代码块保留原有格式；请在普通正文中选择文字');
      if (elementOf(range.startContainer)?.closest(PROTECTED) || elementOf(range.endContainer)?.closest(PROTECTED) ||
          Array.from(first.querySelectorAll(PROTECTED)).some(node => range.intersectsNode(node))) throw new Error('选区包含注脚、引用内容或修订标记，请缩小选区后操作');
      return first;
    }
    function offset(block, node, offset) { const range = document.createRange(); range.selectNodeContents(block); range.setEnd(node, offset); return range.toString().length; }
    function bookmark(surface, range = root.getSelection()?.rangeCount ? root.getSelection().getRangeAt(0) : null) {
      if (!range || !surface.contains(range.startContainer) || !surface.contains(range.endContainer)) return null;
      function point(node, position) {
        const block = blockOf(node) || surface;
        const previous = node.nodeType === 1 && node.childNodes[position - 1], next = node.nodeType === 1 && node.childNodes[position];
        const edgeNode = previous?.nodeType === 1 && previous.ditaSourcePath !== undefined ? previous : next?.nodeType === 1 && next.ditaSourcePath !== undefined ? next : null;
        return { block: block === surface ? null : block.ditaSourcePath, offset: offset(block, node, position), ...(edgeNode ? { edge: edgeNode.ditaSourcePath, after: edgeNode === previous } : {}) };
      }
      const selected = root.getSelection();
      return { start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset), backward: !range.collapsed && selected?.anchorNode === range.endContainer && selected.anchorOffset === range.endOffset,
        scrollTop: A.dom.visualEditor.scrollTop, scrollLeft: A.dom.visualEditor.scrollLeft };
    }
    function afterNode(path) { return { start: { edge: path, after: true }, end: { edge: path, after: true } }; }
    function restore(surface, saved, { scroll = true } = {}) {
      if (!saved || !surface?.isConnected) return false;
      const find = path => Array.from(surface.querySelectorAll('*')).find(node => node.ditaSourcePath === path);
      function point(value) {
        if (value.edge !== undefined) { const edge = find(value.edge); if (edge) return [edge.parentNode, Array.from(edge.parentNode.childNodes).indexOf(edge) + (value.after ? 1 : 0)]; }
        const block = value.block == null ? surface : find(value.block); if (!block) return null;
        let remaining = value.offset || 0, node, last; const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        while ((node = walker.nextNode())) {
          last = node;
          if (remaining <= node.length) {
            const marker = node.parentElement.closest('[data-dita-source="fn"]');
            if (marker) return [marker.parentNode, Array.from(marker.parentNode.childNodes).indexOf(marker) + (remaining ? 1 : 0)];
            return [node, remaining];
          }
          remaining -= node.length;
        }
        return last ? [last, last.length] : [block, 0];
      }
      const start = point(saved.start), end = point(saved.end); if (!start || !end) return false;
      const range = document.createRange(); range.setStart(...start); range.setEnd(...end);
      surface.focus({ preventScroll: true }); const selected = root.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      if (saved.backward && selected.setBaseAndExtent) selected.setBaseAndExtent(...end, ...start);
      if (scroll && saved.scrollTop !== undefined) { A.dom.visualEditor.scrollTop = saved.scrollTop; A.dom.visualEditor.scrollLeft = saved.scrollLeft; }
      else if (scroll) blockOf(range.endContainer)?.scrollIntoView({ block: 'nearest' });
      remember(); return true;
    }
    function restoreTarget(target) { check(target); const saved = bookmark(target.surface, target.range); return restore(target.surface, saved); }
    function focus(surface, path, start, end = start) {
      restore(surface, { start: { block: path, offset: start }, end: { block: path, offset: end } }, { scroll: false });
      const block = Array.from(surface.querySelectorAll('*')).find(node => node.ditaSourcePath === path); block?.scrollIntoView({ block: 'nearest' });
    }
    function commit(target, copy, focusNode, start = 0, end = start) {
      check(target);
      const content = A.ditaCore.updateCurrentFromVisual(null, { visualEditor: copy }, target.current);
      A.validateXml(content); check(target);
      const path = focusNode?.ditaSourcePath;
      A.applyAuthorEdit(target.file, content, target.surface, { selectionBefore: bookmark(target.surface, target.range), selectionAfter: path === undefined ? null : { start: { block: path, offset: start }, end: { block: path, offset: end } } });
      if (path !== undefined) target.surface.querySelectorAll('*').forEach(node => { if (node.ditaSourcePath === path) node.scrollIntoView({ block: 'nearest' }); });
      return content;
    }
    function insertInline(target, node, { collapse = false, wrap = false } = {}) {
      const { copy, range } = clone(target), block = validateRange(range, copy, { body: true });
      const element = elementOf(range.endContainer);
      if (block.matches('pre,h2,h3,h4') || element.closest('[data-dita-source="xref"]') || Array.from(block.querySelectorAll('[data-dita-source="xref"]')).some(link => range.intersectsNode(link))) throw new Error('请在普通正文、列表或表格文字中插入，不能嵌套链接');
      let placed = node;
      if (wrap && !range.collapsed) {
        const parts = textParts(range, block), original = range.toString(), label = node.textContent;
        if (!parts.length) throw new Error('请选择正文文字作为链接');
        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i], text = part.node.data, fragment = document.createDocumentFragment();
          if (part.start) fragment.append(document.createTextNode(text.slice(0, part.start)));
          if (label === original || i === 0) {
            const link = node.cloneNode(false); link.textContent = label === original ? text.slice(part.start, part.end) : label; fragment.append(link); if (i === parts.length - 1 || label !== original) placed = link;
          }
          if (part.end < text.length) fragment.append(document.createTextNode(text.slice(part.end)));
          part.node.replaceWith(fragment);
        }
      } else { if (collapse) range.collapse(false); else range.deleteContents(); range.insertNode(node); }
      const content = A.ditaCore.updateCurrentFromVisual(null, { visualEditor: copy }, target.current); A.validateXml(content); check(target);
      A.applyAuthorEdit(target.file, content, target.surface, { selectionBefore: bookmark(target.surface, target.range), selectionAfter: afterNode(placed.ditaSourcePath) });
      return content;
    }
    document.addEventListener('selectionchange', remember);
    A.dom.visualEditor.addEventListener('compositionstart', () => { composing = true; });
    A.dom.visualEditor.addEventListener('compositionend', () => { composing = false; remember(); });
    A.events.on('workspace:willChange', () => { remembered = null; });
    A.events.on('file:opened', () => { remembered = null; });
    return { capture, clone, check, commit, insertInline, bookmark, restore, restoreTarget, afterNode, focus, offset, validateRange, blockOf, textParts, surfaceOf, connected, remember, BLOCKS, PROTECTED };
  }
  root.DitaAuthorSelection = { createController };
})(window);
