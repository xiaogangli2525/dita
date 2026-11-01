'use strict';
(function (root) {
  // Own structural keystrokes before the browser mutates contenteditable HTML.
  // Every mutation is made on a detached copy and committed as one undo step.
  function createController(A) {
    const selection = A.authorSelection, host = A.dom.visualEditor;
    const element = node => node.nodeType === 1 ? node : node.parentElement;
    const tag = node => node?.getAttribute('data-dita-source') || node?.localName;
    const fresh = (name, html = name) => { const node = document.createElement(html); node.dataset.ditaSource = name; return node; };
    let composing = false, escapeTab = false;
    function fail(error) { A.setStatus(error.message, true); A.toast(error.message, 'error'); }
    function run(action) { try { return action(); } catch (error) { fail(error); } }
    function context() { const target = selection.capture(), cloned = selection.clone(target); return { target, ...cloned }; }
    function commit(ctx, node, start = 0, end = start) { selection.commit(ctx.target, ctx.copy, node, start, end); }
    function insertText(ctx, value) {
      const deleted = selection.deleteRange(ctx.range, ctx.copy), node = document.createTextNode(value);
      deleted.range.insertNode(node);
      commit(ctx, deleted.block, selection.offset(deleted.block, node, node.length));
    }
    function duplicate(node) { const copy = node.cloneNode(false); copy.removeAttribute('id'); copy.classList.remove('author-selected'); return copy; }
    function inherit(from, into) {
      for (const attr of from.attributes) {
        if (['id', 'class', 'style', 'contenteditable'].includes(attr.name) || attr.name.startsWith('data-')) continue;
        if (!['product', 'platform', 'audience', 'otherprops', 'props', 'rev', 'xml:lang', 'outputclass', 'importance', 'translate', 'dir', 'xml:space', 'deliveryTarget', 'base'].includes(attr.name)) continue;
        if (into.hasAttribute(attr.name) && into.getAttribute(attr.name) !== attr.value) throw new Error('适用条件或属性不同，无法直接调整层级');
        into.setAttribute(attr.name, attr.value);
      }
    }
    function split(ctx, block) {
      const range = ctx.range;
      range.deleteContents();
      const tail = range.cloneRange(); tail.setEnd(block, block.childNodes.length);
      const next = duplicate(block); next.append(tail.extractContents()); block.after(next);
      commit(ctx, next);
    }
    function exitList(ctx, item) {
      const list = item.parentElement;
      if (list.parentElement.matches('li')) return indent(ctx, item, true);
      const paragraph = fresh('p'); inherit(list, paragraph); inherit(item, paragraph);
      if (item.id) paragraph.id = item.id;
      const trailing = duplicate(list);
      while (item.nextSibling) trailing.append(item.nextSibling);
      list.after(paragraph); if (trailing.children.length) paragraph.after(trailing);
      item.remove(); if (!list.children.length) list.remove();
      commit(ctx, paragraph);
    }
    function enter(ctx) {
      const block = selection.validateRange(ctx.range, ctx.copy), name = tag(block);
      if (block.matches('h2,h3,h4')) {
        const container = block.matches('h2') ? ctx.copy.querySelector('[data-dita-body]') : block.parentElement;
        if (container.closest('[data-dita-source="table"]')) throw new Error('表格标题请保持单行；在单元格中继续编写');
        let paragraph = block.matches('h2') ? container.firstElementChild : block.nextElementSibling;
        if (!paragraph?.matches('p[data-dita-source="p"]')) { paragraph = fresh('p'); if (block.matches('h2')) container.prepend(paragraph); else block.after(paragraph); }
        commit(ctx, paragraph); return;
      }
      if (name === 'codeblock' || block.matches('pre')) {
        const start = selection.offset(block, ctx.range.startContainer, ctx.range.startOffset), prefix = block.textContent.slice(0, start), indent = prefix.slice(prefix.lastIndexOf('\n') + 1).match(/^[\t ]*/)[0];
        insertText(ctx, '\n' + indent); return;
      }
      const item = element(ctx.range.startContainer).closest('li');
      if (item && tag(item) === 'li') {
        if (!item.textContent.trim() && !item.querySelector('img,ul,ol,table,' + selection.PROTECTED)) return exitList(ctx, item);
        split(ctx, item); return;
      }
      if (['p', 'note', 'entry', 'dd', 'cmd'].includes(name)) {
        if (name === 'p') return split(ctx, block);
        // Containers keep their identity; new paragraphs stay inside the entry,
        // note or command instead of becoming sibling table cells or notes.
        ctx.range.deleteContents();
        const tail = ctx.range.cloneRange(); tail.setEnd(block, block.childNodes.length);
        const next = fresh('p'); next.append(tail.extractContents()); block.append(next); commit(ctx, next); return;
      }
      throw new Error('此处请使用正文插入工具创建新段落');
    }
    function boundary(ctx, backward) {
      const block = selection.validateRange(ctx.range, ctx.copy);
      const position = selection.offset(block, ctx.range.startContainer, ctx.range.startOffset);
      if (position !== (backward ? 0 : block.textContent.length)) return false;
      const other = backward ? block.previousElementSibling : block.nextElementSibling;
      if (!other || tag(other) !== tag(block) || !['p', 'li'].includes(tag(block))) throw new Error('此处是结构边界，请使用段落或表格工具调整');
      if (selection.attributes(other) !== selection.attributes(block)) throw new Error('段落的适用条件或属性不同，不能直接合并');
      const first = backward ? other : block, last = backward ? block : other, offset = first.textContent.length;
      if (first.querySelector(selection.PROTECTED) || last.querySelector(selection.PROTECTED)) throw new Error('段落包含注脚、引用或修订，请使用对应工具调整');
      if (last.id) { const phrase = fresh('ph', 'span'); phrase.id = last.id; first.append(phrase); }
      first.append(...last.childNodes);
      last.remove(); commit(ctx, first, offset); return true;
    }
    function indent(ctx, item, out) {
      if (tag(item) !== 'li' || !item.parentElement.matches('ul,ol')) throw new Error('请在普通列表项中调整层级');
      const list = item.parentElement, offset = selection.offset(item, ctx.range.startContainer, ctx.range.startOffset);
      if (out) {
        const parent = list.parentElement;
        if (!parent.matches('li') || !parent.parentElement.matches('ul,ol')) { if (item.textContent.trim()) throw new Error('当前已是最外层列表，可用“转换为段落”退出列表'); return exitList(ctx, item); }
        inherit(list, item); inherit(parent, item);
        const trailing = duplicate(list); while (item.nextSibling) trailing.append(item.nextSibling);
        parent.after(item); if (trailing.children.length) item.append(trailing);
        if (!list.children.length) list.remove();
      } else {
        const previous = item.previousElementSibling;
        if (!previous || selection.attributes(previous) !== selection.attributes(item)) throw new Error('需要前一个属性相同的列表项，才能增加缩进');
        let nested = previous.lastElementChild;
        if (nested?.localName !== list.localName || selection.attributes(nested) !== selection.attributes(list)) { nested = duplicate(list); previous.append(nested); }
        nested.append(item);
      }
      commit(ctx, item, offset);
    }
    function codeIndent(ctx, block, out) {
      const text = block.textContent, start = selection.offset(block, ctx.range.startContainer, ctx.range.startOffset), end = selection.offset(block, ctx.range.endContainer, ctx.range.endOffset);
      if (!out && start === end) return insertText(ctx, '    ');
      const lineStart = start ? text.lastIndexOf('\n', start - 1) + 1 : 0, last = end > start && text[end - 1] === '\n' ? end - 1 : end, lineEnd = text.indexOf('\n', last);
      const stop = lineEnd < 0 ? text.length : lineEnd, lines = text.slice(lineStart, stop).split('\n');
      const transformed = lines.map(line => out ? line.replace(/^(?:\t| {1,4})/, '') : '    ' + line), firstDelta = transformed[0].length - lines[0].length, delta = transformed.join('\n').length - lines.join('\n').length;
      block.textContent = text.slice(0, lineStart) + transformed.join('\n') + text.slice(stop);
      commit(ctx, block, Math.max(lineStart, start + firstDelta), Math.max(lineStart, end + delta));
    }
    function tableTab(ctx, cell, out) {
      const original = Array.from(ctx.target.surface.querySelectorAll('td,th')).find(node => node.ditaSourcePath === cell.ditaSourcePath);
      const captured = A.authorCommands.capture(original); root.DitaTableCore.inspect(captured.node.closest('table'));
      const table = cell.closest('table'), cells = Array.from(table.querySelectorAll('td,th')), index = cells.indexOf(cell), next = cells[index + (out ? -1 : 1)];
      if (next) { commit(ctx, next); return; }
      if (out) throw new Error('已经是第一个单元格，可按 Esc 后用 Tab 离开编辑区');
      const row = document.createElement('tr'); row.dataset.ditaSection = 'tbody'; row.dataset.ditaRowAttrs = '{}';
      for (const old of cell.parentElement.children) { const entry = fresh('entry', 'td'); entry.dataset.ditaEntryAttrs = '{}'; row.append(entry); }
      table.querySelector('tbody').append(row); commit(ctx, row.firstElementChild);
    }
    host.addEventListener('beforeinput', event => {
      if (event.defaultPrevented || A.state.mode !== 'visual' || event.isComposing || composing) return;
      const type = event.inputType, selected = root.getSelection(); if (!selected?.rangeCount || !host.contains(selected.anchorNode)) return;
      if (['insertParagraph', 'insertLineBreak'].includes(type)) { event.preventDefault(); run(() => enter(context())); return; }
      if (!['insertText', 'insertReplacementText', 'deleteContentBackward', 'deleteContentForward', 'deleteByCut'].includes(type)) return;
      const live = selected.getRangeAt(0), first = selection.blockOf(live.startContainer), last = selection.blockOf(live.endContainer);
      if (!first || !last) { event.preventDefault(); fail(new Error('请在正文段落中输入，跨结构修改请使用对应工具')); return; }
      if (type.startsWith('delete')) for (const target of event.getTargetRanges?.() || []) {
        const affected = document.createRange(); affected.setStart(target.startContainer, target.startOffset); affected.setEnd(target.endContainer, target.endOffset);
        if (Array.from(host.querySelectorAll(selection.PROTECTED)).some(node => affected.intersectsNode(node))) { event.preventDefault(); fail(new Error('请使用注脚、引用或修订工具修改受保护内容')); return; }
      }
      if (!live.collapsed) {
        if (first !== last) { event.preventDefault(); run(() => insertText(context(), type.startsWith('insert') ? event.data || '' : '')); }
        else if (Array.from(first?.querySelectorAll(selection.PROTECTED) || []).some(node => live.intersectsNode(node))) { event.preventDefault(); fail(new Error('选区包含注脚、引用或修订，请缩小选区后编辑')); }
      } else if (type.startsWith('deleteContent') && first) {
        const offset = selection.offset(first, live.startContainer, live.startOffset), backward = type.endsWith('Backward');
        if (offset === (backward ? 0 : first.textContent.length)) { event.preventDefault(); run(() => boundary(context(), backward)); }
      }
    }, true);
    host.addEventListener('keydown', event => {
      if (A.state.mode !== 'visual' || event.isComposing || composing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { escapeTab = true; return; }
      if (event.key === 'Tab' && escapeTab) { escapeTab = false; return; }
      escapeTab = false;
      if (event.key !== 'Tab') return;
      const selected = root.getSelection(), anchor = element(selected?.anchorNode || host), block = selection.blockOf(anchor);
      if (!block || !host.contains(block)) return;
      const cell = anchor.closest('td,th'), item = anchor.closest('li');
      if (!cell && !item && !block.matches('pre')) return;
      if (cell && event.shiftKey && cell === cell.closest('table').querySelector('td,th')) return;
      event.preventDefault(); run(() => {
        const ctx = context(), cloned = selection.validateRange(ctx.range, ctx.copy);
        if (cell) tableTab(ctx, element(ctx.range.startContainer).closest('td,th'), event.shiftKey);
        else if (cloned.matches('pre')) codeIndent(ctx, cloned, event.shiftKey);
        else indent(ctx, element(ctx.range.startContainer).closest('li'), event.shiftKey);
      });
    });
    host.addEventListener('compositionstart', () => { composing = true; }); host.addEventListener('compositionend', () => { composing = false; });
    host.addEventListener('pointerdown', () => { escapeTab = false; });
    return {};
  }
  root.DitaAuthorInput = { createController };
})(window);
