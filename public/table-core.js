'use strict';
(function (root) {
  const children = (node, name) => Array.from(node?.children || []).filter(child => child.localName === name);
  function inspect(table) {
    const groups = children(table, 'tgroup'), group = groups[0];
    if (groups.length !== 1 || table.querySelector('table,namest,spanspec') || table.querySelector('[namest],[nameend],[morerows],[spanname]')) throw new Error('合并单元格、嵌套表格或跨列定义暂不支持结构调整，请使用源码');
    const rows = Array.from(group.querySelectorAll('row')), count = Number(group.getAttribute('cols'));
    const specs = children(group, 'colspec');
    if (!Number.isInteger(count) || count < 1 || !rows.length || rows.some(row => children(row, 'entry').length !== count) || specs.length && (specs.length !== count || new Set(specs.map(s => s.getAttribute('colname'))).size !== count || specs.some((s, i) => !s.getAttribute('colname') || s.hasAttribute('colnum') && Number(s.getAttribute('colnum')) !== i + 1))) throw new Error('此表格列定义不规则，请在源码中调整');
    if (rows.some(row => children(row, 'entry').some((entry, i) => entry.hasAttribute('colname') && entry.getAttribute('colname') !== specs[i]?.getAttribute('colname')))) throw new Error('此表格使用非连续列定位，请在源码中调整');
    return { group, rows, count, specs };
  }
  function apply(table, cell, action, value) {
    const { group, rows, count, specs } = inspect(table), doc = table.ownerDocument;
    const row = cell?.parentElement, index = row ? children(row, 'entry').indexOf(cell) : -1;
    if (index < 0 || !rows.includes(row)) throw new Error('请先选择表格单元格');
    if (action.startsWith('row-')) {
      if (action === 'row-delete') {
        if (children(row.parentElement, 'row').length <= 1 && row.parentElement.localName === 'tbody') throw new Error('表格正文至少保留一行');
        const section = row.parentElement; row.remove(); if (!children(section, 'row').length) section.remove();
      } else {
        const fresh = doc.createElement('row');
        for (let i = 0; i < count; i++) fresh.appendChild(doc.createElement('entry'));
        row.parentNode.insertBefore(fresh, action === 'row-before' ? row : row.nextSibling);
      }
    } else if (action === 'header') {
      const from = row.parentElement, name = from.localName === 'thead' ? 'tbody' : 'thead';
      if (name === 'thead' && children(from, 'row').length <= 1) throw new Error('表格正文至少保留一行');
      let section = children(group, name)[0];
      if (!section) { section = doc.createElement(name); if (name === 'thead') group.insertBefore(section, children(group, 'tbody')[0]); else group.appendChild(section); }
      section.insertBefore(row, name === 'tbody' ? section.firstChild : null); if (!children(from, 'row').length) from.remove();
    } else if (action === 'width') {
      if (!/^(?:\d+(?:\.\d+)?(?:\*|mm|cm|in|pt|pc|px))$/.test(value || '') || parseFloat(value) <= 0) throw new Error('列宽请输入 1*、2* 或 30mm 等正数');
      if (!specs.length) for (let i = 0; i < count; i++) { const spec = doc.createElement('colspec'); spec.setAttribute('colname', 'c' + (i + 1)); spec.setAttribute('colwidth', '1*'); group.insertBefore(spec, children(group, 'thead')[0] || children(group, 'tbody')[0]); specs.push(spec); }
      specs[index].setAttribute('colwidth', value);
    } else if (action.startsWith('col-')) {
      const removing = action === 'col-delete', position = index + (action === 'col-after' ? 1 : 0);
      if (removing && count <= 1) throw new Error('表格至少保留一列');
      for (const item of rows) { const entries = children(item, 'entry'); if (removing) entries[index].remove(); else item.insertBefore(doc.createElement('entry'), entries[position] || null); }
      if (specs.length) {
        if (removing) specs[index].remove();
        else { const spec = doc.createElement('colspec'), names = new Set(specs.map(s => s.getAttribute('colname'))); let serial = 1; while (names.has('c' + serial)) serial++; spec.setAttribute('colname', 'c' + serial); spec.setAttribute('colwidth', '1*'); group.insertBefore(spec, specs[position] || children(group, 'thead')[0] || children(group, 'tbody')[0]); }
        children(group, 'colspec').forEach((spec, i) => { if (spec.hasAttribute('colnum')) spec.setAttribute('colnum', String(i + 1)); });
      }
      group.setAttribute('cols', String(count + (removing ? -1 : 1)));
    } else throw new Error('未知表格操作');
  }
  const api = { inspect, apply, children };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaTableCore = api;
})(typeof window === 'undefined' ? globalThis : window);
