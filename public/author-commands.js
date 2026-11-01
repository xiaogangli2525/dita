'use strict';
(function (root) {
  // All inspector commands start from the acknowledged rendered source and
  // commit through the same validated history boundary as selection tools.
  function createController({ state, dom, core, selection, apply, validate }) {
    const elements = node => Array.from(node.children || []);
    const at = (node, path) => path === '' ? node : String(path).split('/').reduce((parent, i) => elements(parent)[Number(i)], node);
    const spanAt = (node, path) => path === '' ? node : String(path).split('/').reduce((parent, i) => parent.children.filter(child => child.kind === 'element')[Number(i)], node);
    function capture(element) {
      const surface = element?.closest('.map-topic-surface') || dom.visualEditor, path = surface.dataset.mapTopicPath || state.activePath;
      const file = state.filesMap.get(path);
      if (state.mode !== 'visual' || !file || !surface.contains(element) || element.ditaSourcePath === undefined || surface.ditaSourceContent !== file.current) throw new Error('正文或选中元素已变化，请重新选择');
      if (element.closest(selection.PROTECTED)) throw new Error('引用内容、注脚或修订标记请使用对应编辑工具');
      const xmlPath = element.ditaSourcePath, document = core.parseXml(file.current), node = at(document.documentElement, xmlPath);
      return { file, surface, element, node, document, xmlPath, current: file.current, activePath: state.activePath, before: selection.bookmark(surface) };
    }
    function commit(target, path, replacement, after) {
      if (state.activePath !== target.activePath || state.filesMap.get(target.file.path) !== target.file || target.file.current !== target.current || target.surface.ditaSourceContent !== target.current || !target.element.isConnected) throw new Error('正文已变化，请重新选择元素');
      const span = spanAt(root.DitaXmlSource.inspectSource(target.current), path), end = span.close?.end ?? span.end;
      const content = target.current.slice(0, span.start) + replacement + target.current.slice(end);
      validate(content);
      apply(target.file, content, target.surface, { selectionBefore: target.before, selectionAfter: after || target.before });
    }
    function serialize(node) { return new XMLSerializer().serializeToString(node); }
    function replace(target, node) { commit(target, target.xmlPath, serialize(node), selection.afterNode(target.xmlPath)); }
    function attribute(target, name, value) {
      if (!/^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/.test(name) || /^(?:xmlns(?::|$)|data-|on)/i.test(name)) throw new Error('属性名无效或由编辑器保留');
      const span = spanAt(root.DitaXmlSource.inspectSource(target.current), target.xmlPath);
      const opening = target.node.cloneNode(false); opening.setAttribute(name, value);
      // Patch the opening tag only; preserve all text, comments and child XML.
      let open = serialize(opening);
      if (span.close) open = open.replace(/\/>$/, '>');
      const replacement = open + (span.close ? target.current.slice(span.end, span.close.end) : '');
      commit(target, target.xmlPath, replacement);
    }
    function context(target, action, value) {
      let node = target.node;
      const table = node.closest('table');
      if (action === 'delete' && table) node = table;
      if (['delete', 'remove'].includes(action)) {
        if (['title', 'body', 'conbody', 'taskbody', 'refbody'].includes(node.localName)) throw new Error('此结构不能直接删除');
        commit(target, corePath(node), '', null); return;
      }
      if (/^(row-|col-)|^(header|width)$/.test(action)) {
        if (!table) throw new Error('请先选择表格单元格');
        const path = corePath(table); root.DitaTableCore.apply(table, node.closest('entry'), action, value);
        commit(target, path, serialize(table)); return;
      }
      throw new Error('不支持的内容操作，请使用正文插入工具');
    }
    function corePath(node) { const parts = []; while (node.parentElement) { parts.unshift(elements(node.parentElement).indexOf(node)); node = node.parentElement; } return parts.join('/'); }
    return { capture, attribute, context, replace };
  }
  root.DitaAuthorCommands = { createController };
})(window);
