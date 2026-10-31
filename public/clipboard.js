'use strict';
(function (root) {
  // Clipboard HTML is parsed inertly and converted from an allowlist. No
  // attributes, IDs, Word metadata or browser HTML tables enter document XML.
  function normalize(html, text, core) {
    const doc = core.parseXml('<body/>'), body = doc.documentElement, warnings = [];
    const make = (tag, value) => { const node = doc.createElement(tag); if (value) node.textContent = value; return node; };
    if (!html) { String(text).replace(/\r\n?/g, '\n').split('\n').forEach(line => body.appendChild(make('p', line))); return { body, warnings }; }
    const input = new DOMParser().parseFromString(html, 'text/html');
    function convert(node) {
      if (node.nodeType === 3) return doc.createTextNode(node.data);
      if (node.nodeType !== 1 || ['script', 'style', 'meta', 'link', 'object', 'iframe', 'noscript'].includes(node.localName)) return null;
      const tag = node.localName;
      if (tag === 'img') { warnings.push('图片请使用插入图片工具'); return doc.createTextNode(node.getAttribute('alt') || ''); }
      if (tag === 'br') return doc.createTextNode('\n');
      if (tag === 'table') {
        const rows = Array.from(node.rows || []), count = rows[0]?.cells.length || 0;
        if (!count || count > 50 || rows.length > 500 || rows.some(row => row.cells.length !== count || Array.from(row.cells).some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1 || cell.querySelector('table')))) throw new Error('表格包含合并单元格或不规则列');
        const table = make('table'), group = make('tgroup'); group.setAttribute('cols', String(count)); table.appendChild(group);
        let head = null, contents = null;
        rows.forEach((row, index) => {
          const header = index === 0 && Array.from(row.cells).every(cell => cell.localName === 'th') && rows.length > 1;
          let section = header ? head : contents;
          if (!section) { section = make(header ? 'thead' : 'tbody'); group.appendChild(section); if (header) head = section; else contents = section; }
          const newRow = make('row'); section.appendChild(newRow);
          for (const cell of row.cells) { const entry = make('entry'); newRow.appendChild(entry); for (const child of cell.childNodes) { const converted = convert(child); if (converted) entry.appendChild(converted); } }
        }); return table;
      }
      const mapped = { strong: 'b', b: 'b', em: 'i', i: 'i', u: 'u', code: 'codeph', pre: 'codeblock', p: 'p', div: 'p', h1: 'p', h2: 'p', h3: 'p', h4: 'p', ul: 'ul', ol: 'ol', li: 'li', a: 'xref' }[tag];
      const result = mapped ? make(mapped) : doc.createDocumentFragment();
      if (mapped === 'xref') {
        const href = node.getAttribute('href') || '';
        if (/^(?:https?:\/\/|mailto:|#)/i.test(href)) { result.setAttribute('href', href); if (!href.startsWith('#')) result.setAttribute('scope', 'external'); }
        else { warnings.push('不支持的链接已保留文字'); return doc.createTextNode(node.textContent); }
      }
      if (mapped === 'codeblock') result.textContent = node.textContent;
      else for (const child of node.childNodes) { const converted = convert(child); if (converted) result.appendChild(converted); }
      // Browser/Word wrappers often enclose blocks in div/span. Flatten the
      // wrapper instead of creating invalid nested DITA paragraphs.
      if (mapped === 'p' && result.querySelector('p,table,ul,ol,codeblock')) { const fragment = doc.createDocumentFragment(); fragment.append(...result.childNodes); return fragment; }
      return result;
    }
    try { for (const node of input.body.childNodes) { const converted = convert(node); if (converted) body.appendChild(converted); } }
    catch (error) { const plain = normalize('', text || input.body.textContent, core); plain.warnings.push(error.message + '，已按纯文本粘贴'); return plain; }
    return { body, warnings: [...new Set(warnings)] };
  }
  function createController({ dom, state, selection, core, status, toast }) {
    dom.visualEditor.addEventListener('paste', event => {
      if (state.mode !== 'visual' || !dom.visualEditor.contains(event.target)) return;
      event.preventDefault();
      try {
        const html = event.clipboardData?.getData('text/html') || '', text = event.clipboardData?.getData('text/plain') || '';
        if (html.length + text.length > 1024 * 1024) throw new Error('粘贴内容过大，请分段插入');
        if (!html && !text) throw new Error('请先上传图片，再插入文档');
        const target = selection.capture(), { copy, range } = selection.clone(target), block = selection.validateRange(range, copy, { body: true });
        if (block.matches('pre')) { range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); selection.commit(target, copy, block, selection.offset(block, node, node.length)); return; }
        const { body, warnings } = normalize(html, text, core), blocks = Array.from(body.children), hasBlocks = blocks.some(node => ['p', 'ul', 'ol', 'table', 'codeblock'].includes(node.localName));
        const fragment = document.createDocumentFragment();
        const inline = blocks.length === 1 && blocks[0].localName === 'p' && body.childNodes.length === 1;
        for (const child of inline ? blocks[0].childNodes : body.childNodes) { const rendered = core.renderDitaNode(child, document); if (rendered) fragment.appendChild(rendered); }
        range.deleteContents();
        let focus = block, caret;
        if (!inline && hasBlocks && block.matches('p')) {
          const tailRange = range.cloneRange(); tailRange.setEnd(block, block.childNodes.length); const tail = tailRange.extractContents(), after = document.createElement('p');
          after.setAttribute('data-dita-source', 'p'); after.appendChild(tail);
          // Splitting a conditioned paragraph must retain its applicability on
          // every new sibling, including a pasted table or list.
          for (const name of ['product', 'platform', 'audience', 'otherprops', 'rev', 'xml:lang', 'outputclass', 'importance', 'translate', 'dir', 'xml:space']) {
            if (!block.hasAttribute(name)) continue;
            after.setAttribute(name, block.getAttribute(name));
            for (const node of fragment.children) node.setAttribute(name, block.getAttribute(name));
          }
          const inserted = fragment.lastChild; block.after(fragment, after); focus = inserted?.nodeType === 1 ? inserted : after;
          if (focus.matches('[data-dita-source="table"]')) focus = after;
          caret = focus.textContent.length;
        } else {
          if (!inline && hasBlocks && !block.matches('td,th,li,[data-dita-source="dd"]')) throw new Error('此处仅支持普通文字粘贴，请选择正文段落');
          const last = fragment.lastChild; range.insertNode(fragment);
          if (last) caret = selection.offset(block, last, last.nodeType === 3 ? last.length : last.childNodes.length); else caret = 0;
        }
        selection.commit(target, copy, focus, caret);
        status('已粘贴并转换为文档内容，可撤销；保存后写入工作区');
        if (warnings.length) toast(warnings.join('；'), 'info');
      } catch (error) { status('粘贴未应用：' + error.message, true); toast(error.message, 'error'); }
    });
    dom.visualEditor.addEventListener('dragover', event => { if (state.mode === 'visual') event.preventDefault(); });
    dom.visualEditor.addEventListener('drop', event => { if (state.mode === 'visual') { event.preventDefault(); status('请使用粘贴或插入图片工具添加内容'); } });
  }
  root.DitaClipboard = { normalize, createController };
})(window);
