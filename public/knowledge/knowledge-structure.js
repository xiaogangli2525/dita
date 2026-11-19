'use strict';
(function (root) {
  const SCHEMA = 1;
  const prose = value => String(value || '').replace(/\s+/g, ' ').trim();
  // A deterministic content identity for invalidation, not an authenticity signature.
  function fingerprint(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let a = 2166136261, b = 2654435769;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 2246822519); }
    return text.length + '-' + (a >>> 0).toString(16) + '-' + (b >>> 0).toString(16);
  }
  function tree(node) {
    if (node.nodeType === 3 || node.nodeName === '#text') return { name: '#text', value: node.nodeValue ?? node.value };
    return { name: node.localName || node.tagName || '#root', attrs: Object.fromEntries(Array.from(node.attributes || node.attrs || [], attr => [attr.name, attr.value])),
      children: Array.from(node.childNodes || [], tree), origin: node };
  }
  const hasClass = (node, name) => (node.attrs?.class || '').split(/\s+/).includes(name);
  function descendants(node, predicate, stop = () => false) {
    const result = [];
    function visit(current) { if (predicate(current)) result.push(current); if (!stop(current)) (current.children || []).forEach(visit); }
    visit(node); return result;
  }
  function text(node, raw = false) {
    if (node.name === '#text') return node.value || '';
    if (['script', 'style', 'button', 'nav'].includes(node.name) || hasClass(node, 'fn-ref') || hasClass(node, 'footnote-backlink') || node.attrs?.['aria-hidden'] === 'true') return '';
    if (node.name === 'br') return '\n';
    if (node.name === 'img') return node.attrs?.alt || '';
    const value = (node.children || []).map(child => text(child, raw || node.name === 'pre')).join('');
    return !raw && /^(p|div|li|pre|dl|dt|dd|tr|td|th|h[2-6])$/.test(node.name) ? '\n' + value.trim() + '\n' : value;
  }
  const clean = node => text(node).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  function definitions(node) {
    return new Map(descendants(node, current => current.attrs?.id && (current.children || []).some(child => hasClass(child, 'footnote-content')))
      .map(current => [current.attrs.id, clean(current.children.find(child => hasClass(child, 'footnote-content')))]));
  }
  function extract(fragment, noteMap = new Map(), chapterAnchor = '') {
    const units = [], warnings = [], occurrences = new Map(); let section = [];
    function notesFor(node) {
      const ids = [...new Set(descendants(node, current => hasClass(current, 'fn-ref')).flatMap(current => descendants(current, child => child.name === 'a')
        .map(link => (link.attrs.href || '').replace(/^#/, ''))))];
      return ids.map(id => { if (!noteMap.has(id)) throw Error('结构化分片缺少关联注脚：' + id); return { id, text: noteMap.get(id) }; });
    }
    function add(node, kind, content = clean(node), context = [], noteNodes = []) {
      if (!content.trim()) return;
      const notes = [...new Map([...notesFor(node), ...noteNodes.flatMap(notesFor)].map(note => [note.id, note])).values()], values = { kind, section: section.filter(Boolean), context: context.filter(Boolean), text: content, notes };
      const signature = fingerprint(values), duplicate = occurrences.get(signature) || 0; occurrences.set(signature, duplicate + 1);
      const id = 'b-' + signature + (duplicate ? '-' + duplicate : '');
      const sourceAnchor = node.attrs?.id || (chapterAnchor && node.origin?.setAttribute ? chapterAnchor + '--' + id : chapterAnchor);
      // This marker only enriches the sealed published DOM. Source DITA is untouched.
      if (sourceAnchor && node.origin?.setAttribute) { node.origin.setAttribute('id', sourceAnchor); node.origin.setAttribute('data-kb-block', id); }
      units.push({ id, ...values, sourceAnchor, fingerprint: signature });
      if (units.length > 12000) throw Error('结构块超过 12000 个，请减少本次发布内容');
    }
    function table(node, inherited, inheritedNotes = []) {
      const rows = [];
      function collect(current, head = false) {
        if (current !== node && current.name === 'table') return;
        if (current.name === 'tr') { rows.push({ node: current, head }); return; }
        (current.children || []).forEach(child => collect(child, head || current.name === 'thead'));
      }
      collect(node);
      let spans = [], headers = [], headerNodes = [], labelNodes = [], caption = '', captionNodes = [], parameter = null, labels = [...inherited];
      const headerWord = /^(?:参数(?:名)?|名称|类型|说明|描述|取值|范围|默认值|单位|语法|响应|错误码|含义|值|结果|parameter|description|syntax|response|value|default|type|code|meaning|name|range|unit)$/i;
      for (const row of rows) {
        const grid = [], next = [];
        for (const [column, span] of spans.entries()) if (span?.left > 0) { grid[column] = span.cell; if (span.left > 1) next[column] = { cell: span.cell, left: span.left - 1 }; }
        let column = 0;
        for (const cell of (row.node.children || []).filter(child => child.name === 'td' || child.name === 'th')) {
          while (grid[column]) column++;
          const width = Number(cell.attrs.colspan || 1), height = Number(cell.attrs.rowspan || 1);
          if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 128 || height > 2000 || column + width > 128) throw Error('表格跨度超出结构化分片支持范围');
          for (let offset = 0; offset < width; offset++) { if (grid[column + offset]) throw Error('表格合并单元格重叠，请核对原文'); grid[column + offset] = cell; if (height > 1) next[column + offset] = { cell, left: height - 1 }; }
          column += width;
        }
        spans = next;
        const cells = [...new Set(grid.filter(Boolean))], values = cells.map(cell => prose(clean(cell)));
        if (row.head || cells.length > 1 && cells.every(cell => cell.name === 'th') || cells.length > 1 && values.every(value => headerWord.test(value))) {
          parameter = null; headerNodes.push(...cells);
          headers = grid.map((cell, i) => [...new Set([headers[i], cell && prose(clean(cell))].filter(Boolean))].join(' / ')); continue;
        }
        if (cells.length === 1) {
          const cell = cells[0], value = values[0];
          const heading = /^(?:AT\+[\w+.-]+|命令描述|参数描述|语法|响应|示例|注意事项|command description|parameters?|syntax|responses?|examples?)$/i.test(value);
          if (heading) {
            if (/^AT\+/i.test(value)) { caption = value; captionNodes = [row.node]; }
            parameter = null; labels = [...inherited, caption, value === caption ? '' : value].filter(Boolean); labelNodes = [...captionNodes, row.node]; headers = []; headerNodes = []; add(row.node, 'heading', value, inherited, inheritedNotes); continue;
          }
          // A full-width DITA cell often contains all parameter definitions as p/dl.
          const parameterName = /^<[a-z_][a-z0-9_]*>/i.test(value);
          const enumeration = descendants(cell, child => ['dl', 'ul', 'ol', 'pre'].includes(child.name)).length > 0;
          if (!parameterName && enumeration && parameter) {
            add(cell, 'table-row', clean(cell), [...labels, '参数定义：' + parameter.text], [...inheritedNotes, ...headerNodes, ...labelNodes, parameter.node]); continue;
          }
          if (parameterName) {
            const first = descendants(cell, child => child.name === 'p')[0], children = cell.children || [];
            const boundary = children.findIndex(child => ['dl', 'ul', 'ol', 'pre'].includes(child.name));
            const definition = first && /^<[a-z_][a-z0-9_]*>/i.test(prose(clean(first))) ? prose(clean(first)) : prose(clean({ children: children.slice(0, boundary < 0 ? children.length : boundary) }));
            parameter = { text: definition, node: cell };
            if (!descendants(cell, child => child.name === 'p').length) { add(cell, 'table-row', clean(cell), [...labels, '参数定义：' + definition], [...inheritedNotes, ...headerNodes, ...labelNodes]); continue; }
          } else parameter = null;
          const children = cell.children || [], intro = child => child.name === 'p' && /^<[a-z_][a-z0-9_]*>/i.test(prose(clean(child)));
          const parameters = children.map((child, i) => intro(child) ? i : -1).filter(i => i >= 0);
          const context = [...labels, ...headers.filter(Boolean)], attached = [...inheritedNotes, ...headerNodes, ...labelNodes];
          if (parameters.length) {
            const prefix = children.slice(0, parameters[0]), shared = prose(clean({ children: prefix }));
            if (shared) walk({ children: prefix }, context, 'table-row', attached);
            parameters.forEach((start, i) => {
              const definition = children[start], group = { ...cell, attrs: definition.attrs || {}, origin: definition.origin, children: children.slice(start, parameters[i + 1] ?? children.length) };
              // Enumeration lists and examples belong to their parameter, not to
              // an isolated zero/one value. Repeat the definition on long splits.
              parameter = { text: prose(clean(definition)), node: group };
              add(group, 'table-row', clean(group), [...context, ...(shared ? ['共同说明：' + shared] : []), '参数定义：' + prose(clean(definition))], [...attached, { children: prefix }]);
            });
            continue;
          }
          const blocks = children.filter(child => ['p', 'pre', 'div', 'dl', 'ul', 'ol'].includes(child.name));
          if (blocks.length) { walk(cell, context, 'table-row', attached); continue; }
        }
        const lines = [], seen = new Set();
        for (const [i, cell] of grid.entries()) if (cell && !seen.has(cell)) { seen.add(cell); const value = clean(cell); if (value) lines.push((headers[i] ? headers[i] + '：' : '') + value); }
        const notes = cells.flatMap(notesFor), synthetic = { ...row.node, children: cells };
        // Inherited rowspan content contributes both its label and any referenced note.
        const key = cells[0] && prose(clean(cells[0]));
        const rowContext = key && key.length <= 160 && cells.length > 1 ? [...labels, '行标识：' + key] : labels;
        add(synthetic, 'table-row', lines.join('\n'), rowContext, [...inheritedNotes, ...headerNodes, ...labelNodes]);
        if (notes.length && !units.at(-1)?.notes.length) throw Error('表格注脚关联失败');
      }
    }
    function walk(node, context = [], inheritedKind = '', noteNodes = []) {
      if (!node || node.name === '#text' || ['script', 'style', 'nav', 'button'].includes(node.name) || hasClass(node, 'export-footnotes')) return;
      if (/^h[2-6]$/.test(node.name)) { const depth = node.attrs?.id === chapterAnchor ? -1 : Math.max(0, Number(node.name[1]) - 2); if (depth >= 0) { section = section.slice(0, depth); section[depth] = prose(clean(node)); } add(node, 'heading', prose(clean(node)), context, noteNodes); return; }
      if (node.name === 'table') { table(node, context, noteNodes); return; }
      if (node.name === 'pre') { add(node, 'code', text(node, true).replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, ''), context, noteNodes); return; }
      if (node.name === 'dl') {
        let term;
        for (const child of descendants(node, current => current.name === 'dt' || current.name === 'dd', current => current !== node && current.name === 'dl')) { if (child.name === 'dt') term = child; else if (child.name === 'dd') add({ ...child, children: [term, child].filter(Boolean) }, inheritedKind || 'definition', [term && clean(term), clean(child)].filter(Boolean).join('\n'), context, noteNodes); }
        return;
      }
      if (node.name === 'ol' || node.name === 'ul') {
        let i = 0;
        for (const child of (node.children || []).filter(current => current.name === 'li')) add(child, node.name === 'ol' ? 'step' : inheritedKind || 'list-item', (node.name === 'ol' ? '步骤 ' + (++i) + '：' : '') + clean(child), context, noteNodes);
        return;
      }
      if (hasClass(node, 'dita-note')) { add(node, 'note', clean(node), context, noteNodes); return; }
      if (node.name === 'p' || node.name === 'figcaption' || node.name === 'figure' || node.name === 'img') { add(node, inheritedKind || (node.name === 'figure' || node.name === 'img' ? 'figure' : 'paragraph'), clean(node), context, noteNodes); return; }
      const savedSection = [...section];
      let inline = [];
      const flush = () => { if (inline.length) { add({ children: inline }, inheritedKind || 'paragraph', clean({ children: inline }), context, noteNodes); inline = []; } };
      for (const child of node.children || []) {
        if (/^(?:h[2-6]|table|pre|dl|ol|ul|p|div|section|figure|figcaption)$/.test(child.name)) { flush(); walk(child, context, inheritedKind, noteNodes); }
        else inline.push(child);
      }
      flush();
      if (node.name === 'section') section = savedSection;
    }
    walk(fragment);
    return { units, warnings };
  }
  function seal(title, value, units, warnings = []) { return { schema: SCHEMA, source: fingerprint(title + '\n' + prose(value)), units, warnings }; }
  function validate(record) {
    const value = record.structure;
    if (!value) return null;
    if (value.schema !== SCHEMA || value.source !== fingerprint(record.title + '\n' + prose(record.text)) || !Array.isArray(value.units) || value.units.length > 12000 || !Array.isArray(value.warnings)) throw Error('章节结构与正文不一致，请重新发布：' + record.title);
    const ids = new Set();
    for (const unit of value.units) {
      if (!unit || typeof unit.id !== 'string' || ids.has(unit.id) || typeof unit.kind !== 'string' || typeof unit.text !== 'string' || !Array.isArray(unit.section) || !Array.isArray(unit.context) || [...unit.section, ...unit.context].some(item => typeof item !== 'string') || !Array.isArray(unit.notes) || unit.notes.some(note => typeof note.id !== 'string' || typeof note.text !== 'string') || typeof unit.sourceAnchor !== 'string' || unit.fingerprint !== fingerprint({ kind: unit.kind, section: unit.section, context: unit.context, text: unit.text, notes: unit.notes })) throw Error('章节结构块无效，请重新发布：' + record.title);
      ids.add(unit.id);
    }
    return value;
  }
  const api = { SCHEMA, prose, fingerprint, tree, definitions, extract, seal, validate };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeStructure = api;
})(typeof window === 'undefined' ? globalThis : window);
