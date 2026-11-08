'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const notes = typeof module !== 'undefined' ? require('./footnotes-core') : root.DitaFootnotesCore;
  const blocks = new Set(['div', 'p', 'ul', 'ol', 'li']);
  const token = '[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*';
  const list = '(' + token + '(?:\\s*[/、,，]\\s*' + token + ')*)';
  const colon = new RegExp('^(\\s*(?:此外[，,]\\s*)?)' + list + '\\s*[：:]');
  const only = new RegExp('^(\\s*(?:目前)?仅\\s*)' + list + '(?=\\s*(?:支持|适用))');
  const unsupported = new RegExp('^(\\s*)' + list + '(?=(?:暂不支持|不支持|仅支持))');

  function prefix(text, knownModels) {
    const match = colon.exec(text) || only.exec(text) || unsupported.exec(text);
    if (!match) return null;
    const models = match[2].split(/\s*[/、,，]\s*/);
    // A number or an exact registered name distinguishes model identifiers
    // from headings such as "HTTP: ..." and "Note: ...".
    if (!models.every(model => /\d/.test(model) || knownModels.has(model))) return null;
    return { models, start: match[1].length, end: match[1].length + match[2].length };
  }

  // Compact only the explicit model label, preserving all surrounding XML.
  // Text-node spans avoid deleting bold/variable markup or DITA conditions.
  function replaceLabel(fragment, start, end, model) {
    const wrapper = '<wrapper>' + fragment + '</wrapper>', tree = xml.inspectSource(wrapper), patches = [];
    let offset = 0, inserted = false;
    function visit(node) {
      if (node.kind === 'text' || node.kind === 'cdata') {
        const raw = wrapper.slice(node.start + (node.kind === 'cdata' ? 9 : 0), node.end - (node.kind === 'cdata' ? 3 : 0));
        const text = notes.textOf(node.kind === 'cdata' ? '<![CDATA[' + raw + ']]>' : raw), first = offset, last = offset + text.length;
        offset = last;
        if (last <= start || first >= end) return;
        const next = text.slice(0, Math.max(0, start - first)) + (!inserted ? model : '') + text.slice(Math.max(0, end - first));
        inserted = true;
        patches.push({ start: node.start - 9, end: node.end - 9, text: next.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') });
      } else if (node.kind === 'element') node.children.forEach(visit);
    }
    visit(tree);
    for (const patch of patches.sort((a, b) => b.start - a.start)) fragment = fragment.slice(0, patch.start) + patch.text + fragment.slice(patch.end);
    return fragment;
  }

  function analyze(note, model, { knownModels = [], profile } = {}) {
    const known = new Set([...knownModels, model].filter(Boolean));
    let original = note.before, profileFiltered = 0;
    if (profile) {
      function count(node) { if (!profile.keep(node)) { profileFiltered++; return; } node.children.filter(child => child.kind === 'element').forEach(count); }
      count(xml.inspectSource(original));
      original = profile.filterSource(original);
      if (!original) return { inner: '', scoped: 0, excluded: 0, unresolved: [], profileFiltered };
    }
    const parsed = notes.listFootnotes(original)[0], source = '<wrapper>' + parsed.inner + '</wrapper>', tree = xml.inspectSource(source);
    const raw = node => source.slice(node.start, node.close?.end ?? node.end);
    const unresolved = []; let scoped = 0, excluded = 0;
    if(/<\?oxy_delete\b/.test(source))unresolved.push('注脚包含删除修订，请先核对独立规则');

    function revisions(children) {
      const result = [], stack = [];
      for (const node of children) {
        const opening = node.kind === 'pi' && /^<\?oxy_insert_start\b/.test(raw(node));
        const closing = node.kind === 'pi' && /^<\?oxy_insert_end\b/.test(raw(node));
        if (opening) { stack.push({ kind: 'revision', start: node.start, opening: raw(node), children: [] }); continue; }
        if (closing) {
          const group = stack.pop();
          if (!group) throw Error('Oxygen 修订标记不完整');
          group.closing = raw(node); group.end = node.end;
          (stack.length ? stack.at(-1).children : result).push(group); continue;
        }
        (stack.length ? stack.at(-1).children : result).push(node);
      }
      if (stack.length) throw Error('Oxygen 修订标记不完整');
      return result;
    }

    function render(children, inherited = null) {
      let output = '', buffer = '', active = inherited;
      function flush() {
        if (!buffer) return;
        const fragment = buffer; buffer = '';
        const text = notes.textOf(fragment), head = prefix(text, known);
        if(profile&&!head&&/^\s*[：:]/.test(text))unresolved.push('条件过滤后缺少型号标签：'+text.trim());
        if (head) { active = head.models; head.models.forEach(name => known.add(name)); scoped++; }
        if (model && active && !active.includes(model)) { if(text.trim()||/<image\b/.test(fragment))excluded++; return; }
        const mentions = [...known].filter(name => {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const rest = head ? text.slice(head.end).replace(/^\s*[：:]/, '') : text;
          return new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '(?=$|[^A-Za-z0-9_-])').test(rest);
        });
        if (mentions.some(name => name !== model)) unresolved.push(text.trim());
        output += model && head ? replaceLabel(fragment, head.start, head.end, model) : fragment;
      }
      for (const node of revisions(children)) {
        if (node.kind === 'revision' || node.kind === 'element' && blocks.has(node.name)) {
          flush();
          if (node.kind === 'element' && !node.close) { output += raw(node); continue; }
          const body = render(node.children, active);
          if (notes.textOf(body).trim() || /<image\b/.test(body)) output += node.kind === 'revision' ? node.opening + body + node.closing : source.slice(node.start, node.end) + body + source.slice(node.close.start, node.close.end);
        } else if (node.kind === 'text') {
          for (const chunk of raw(node).match(/[^。！？\n]*[。！？\n]|[^。！？\n]+$/g) || []) {
            buffer += chunk; if (/[。！？\n]$/.test(chunk)) flush();
          }
        } else buffer += raw(node);
      }
      flush(); return output;
    }
    let inner;
    try { inner = render(tree.children); xml.validateXml('<fn>' + inner + '</fn>'); }
    catch (error) { return { inner: note.inner, scoped: 0, excluded: 0, unresolved: [error.message], profileFiltered: 0 }; }
    return { inner, scoped, excluded, unresolved: [...new Set(unresolved)], profileFiltered };
  }
  const api = { analyze, prefix };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaModelNoteText = api;
})(typeof window === 'undefined' ? globalThis : window);
