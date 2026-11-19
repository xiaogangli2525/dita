'use strict';
(function (root) {
  function createController(A) {
    const selection = A.authorSelection, get = id => document.getElementById(id);
    const noteTypes = root.DitaDocumentPresentation.noteTypes;
    const options = get('noteTypeOptions');
    for (const [type, label] of Object.entries(noteTypes)) { const option = document.createElement('option'); option.value = type === 'note' ? 'note' : 'note:' + type; option.textContent = label; options.append(option); }
    const source = node => node.getAttribute('data-dita-source') || node.localName;
    const create = (name, html = name) => { const node = document.createElement(html); node.dataset.ditaSource = name; return node; };
    let tableTarget = null;
    function report(error) { A.setStatus(error.message, true); A.toast(error.message, 'error'); }
    function copyAttributes(from, to, { inherit = false } = {}) {
      for (const attr of from.attributes) {
        if (['class', 'style', 'contenteditable', 'type'].includes(attr.name) || attr.name.startsWith('data-') || inherit && attr.name === 'id') continue;
        if (inherit && !['product', 'platform', 'audience', 'otherprops', 'props', 'rev', 'xml:lang', 'outputclass', 'importance', 'translate', 'dir', 'xml:space', 'deliveryTarget', 'base'].includes(attr.name)) continue;
        if (inherit && to.hasAttribute(attr.name) && to.getAttribute(attr.name) !== attr.value) throw new Error('列表与段落的适用条件不同，请先在属性中调整');
        to.setAttribute(attr.name, attr.value);
      }
    }
    function simple(block) {
      if (block.querySelector('p,ul,ol,table,pre,[data-dita-source="note"],[data-dita-source="section"]')) throw new Error('此块包含嵌套结构，请先选择其中的普通段落');
    }
    function extractItem(item, replacement) {
      const list = item.parentElement, trailing = list.cloneNode(false); trailing.removeAttribute('id');
      copyAttributes(list, replacement, { inherit: true });
      while (item.nextSibling) trailing.append(item.nextSibling);
      list.after(replacement); if (trailing.children.length) replacement.after(trailing);
      item.remove(); if (!list.children.length) list.remove();
    }
    function convert(value) {
      try {
        if (!['p', 'ul', 'ol', 'note', 'codeblock'].includes(value) && !(value.startsWith('note:') && Object.hasOwn(noteTypes, value.slice(5)))) return;
        const target = selection.capture(), { copy, range } = selection.clone(target);
        let block = selection.blockOf(range.startContainer), end = selection.blockOf(range.endContainer);
        if (!block || !block.closest('[data-dita-body]') || block.matches('h2,h3,h4,td,th') || block.closest(selection.PROTECTED)) throw new Error('请在正文段落、普通列表项、说明或代码块中转换');
        const multi = block !== end ? selection.paragraphs(range, copy) : [block];
        if (value.startsWith('note') && block.closest('[data-dita-source="note"]')) block = block.closest('[data-dita-source="note"]');
        if (multi.length > 1 && !['ul', 'ol'].includes(value)) throw new Error('多个段落可一起转换为列表，其他类型请逐段转换');
        if (['ul', 'ol'].includes(value)) {
          if (block.matches('li') && block.parentElement.matches('ul,ol')) {
            const old = block.parentElement, list = create(value); copyAttributes(old, list); list.append(...old.childNodes); old.replaceWith(list);
          } else {
            multi.forEach(simple); const list = create(value); block.before(list);
            for (const paragraph of multi) { const item = create('li'); copyAttributes(paragraph, item); item.append(...paragraph.childNodes); list.append(item); paragraph.remove(); }
            block = list.firstElementChild;
          }
        } else {
          if (!(value.startsWith('note') && source(block) === 'note')) simple(block);
          const name = value.split(':')[0], replacement = create(name, name === 'codeblock' ? 'pre' : name === 'note' ? 'div' : 'p'); copyAttributes(block, replacement);
          if (name === 'note') { replacement.className = 'note'; if (value.includes(':')) replacement.setAttribute('type', value.split(':')[1]); }
          else replacement.removeAttribute('othertype');
          if (name === 'codeblock') {
            if (block.querySelector('img,[id],' + selection.PROTECTED)) throw new Error('此段包含图片、锚点或注脚，不能转换为纯文本代码块');
            replacement.textContent = block.textContent;
          } else replacement.append(...block.childNodes);
          if (block.matches('li') && block.parentElement.matches('ul,ol')) extractItem(block, replacement); else block.replaceWith(replacement);
          block = replacement;
        }
        selection.commit(target, copy, block);
        A.setStatus('已转换正文结构，可撤销；保存后写入工作区');
      } catch (error) { report(error); }
    }
    function showTable() {
      try {
        if (get('tableInsertDialog').open) return;
        tableTarget = selection.capture(); const { copy, range } = selection.clone(tableTarget);
        selection.validateRange(range, copy, { body: true });
        get('tableInsertError').textContent = ''; get('tableInsertDialog').showModal(); get('tableRows').focus();
      } catch (error) { report(error); }
    }
    function cancel() {
      const target = tableTarget; tableTarget = null; get('tableInsertDialog').close();
      if (target) try { selection.restoreTarget(target); } catch { /* A newer buffer owns the selection. */ }
    }
    get('tableInsertCancel').addEventListener('click', cancel);
    get('tableInsertDialog').addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    get('tableInsertForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const rows = Number(get('tableRows').value), cols = Number(get('tableCols').value), header = get('tableHeader').checked;
        if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || rows > 100 || cols < 1 || cols > 20 || (rows + Number(header)) * cols > 1000) throw new Error('正文行数限 1–100，列数限 1–20，合计最多 1000 个单元格');
        const { copy, range } = selection.clone(tableTarget); range.collapse(false);
        let anchor = selection.validateRange(range, copy, { body: true });
        if (anchor.matches('h2,h3,h4,pre')) throw new Error('请在正文段落、列表或表格中插入表格');
        if (anchor.closest('td,th')) anchor = anchor.closest('[data-dita-source="table"]');
        const wrapper = create('table', 'div'), table = document.createElement('table'); wrapper.append(table);
        for (const section of header ? ['thead', 'tbody'] : ['tbody']) {
          const group = document.createElement(section); table.append(group);
          for (let i = 0; i < (section === 'thead' ? 1 : rows); i++) {
            const row = document.createElement('tr'); row.dataset.ditaSection = section; row.dataset.ditaRowAttrs = '{}'; group.append(row);
            for (let j = 0; j < cols; j++) { const cell = create('entry', section === 'thead' ? 'th' : 'td'); cell.textContent = section === 'thead' ? '列 ' + (j + 1) : '单元格'; cell.dataset.ditaEntryAttrs = '{}'; row.append(cell); }
          }
        }
        anchor.after(wrapper); const focus = table.querySelector('th,td');
        const target = tableTarget;
        selection.commit(target, copy, focus, 0, focus.textContent.length);
        tableTarget = null; get('tableInsertDialog').close(); selection.focus(target.surface, focus.ditaSourcePath, 0, focus.textContent.length);
        A.setStatus('已插入表格，可直接填写；Tab 切换单元格，末格 Tab 新增一行');
      } catch (error) { get('tableInsertError').textContent = error.message; }
    });
    get('authorBlockSelect').addEventListener('change', event => { const value = event.target.value; event.target.value = ''; convert(value); });
    A.events.on('workspace:willChange', () => { tableTarget = null; get('tableInsertDialog').close(); });
    return { convert, showTable };
  }
  root.DitaAuthorBlocks = { createController };
})(window);
