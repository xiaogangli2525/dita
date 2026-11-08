'use strict';
(function (root) {

  function parseOxyPIAttrs(data) {
    const attrs = {};
    const re = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(data || ''))) {
      attrs[m[1]] = m[2].replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key) => {
        if (key[0] === '#') {
          const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
          return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
        }
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key] ?? entity;
      });
    }
    return attrs;
  }

  function stripOxyTags(text) {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  }

  function processOxyNodes(nodes, doc, getIndex) {
    const result = [];
    let i = 0;
    while (i < nodes.length) {
      const child = nodes[i];
      if (child.nodeType === 7 && child.target === 'oxy_insert_start') {
        const attrs = parseOxyPIAttrs(child.data);
        const ins = doc.createElement('ins');
        ins.setAttribute('class', 'oxy-insert');
        if (getIndex) ins.setAttribute('data-oxy-index', String(getIndex()));
        if (attrs.author) ins.setAttribute('data-author', attrs.author);
        if (attrs.timestamp) ins.setAttribute('data-timestamp', attrs.timestamp);
        i++;
        const inner = [];
        while (i < nodes.length && !(nodes[i].nodeType === 7 && nodes[i].target === 'oxy_insert_end')) {
          inner.push(nodes[i]);
          i++;
        }
        i++;
        for (const n of processOxyNodes(inner, doc)) ins.appendChild(n);
        result.push(ins);
        continue;
      }
      if (child.nodeType === 7 && child.target === 'oxy_delete') {
        const attrs = parseOxyPIAttrs(child.data);
        const del = doc.createElement('del');
        del.setAttribute('class', 'oxy-delete');
        if (getIndex) del.setAttribute('data-oxy-index', String(getIndex()));
        if (attrs.author) del.setAttribute('data-author', attrs.author);
        if (attrs.timestamp) del.setAttribute('data-timestamp', attrs.timestamp);
        del.textContent = attrs.content || '';
        result.push(del);
        i++;
        continue;
      }
      if (child.nodeType === 7 && child.target === 'oxy_comment_start') {
        const attrs = parseOxyPIAttrs(child.data);
        const span = doc.createElement('span');
        span.setAttribute('class', 'oxy-comment');
        if (getIndex) span.setAttribute('data-oxy-index', String(getIndex()));
        if (attrs.author) span.setAttribute('data-author', attrs.author);
        if (attrs.comment) span.setAttribute('data-comment', attrs.comment);
        if (attrs.timestamp) span.setAttribute('data-timestamp', attrs.timestamp);
        i++;
        const inner = [];
        while (i < nodes.length && !(nodes[i].nodeType === 7 && nodes[i].target === 'oxy_comment_end')) {
          inner.push(nodes[i]);
          i++;
        }
        i++;
        for (const n of processOxyNodes(inner, doc)) span.appendChild(n);
        result.push(span);
        continue;
      }
      if (child.nodeType === 7) { i++; continue; }
      result.push(child);
      i++;
    }
    return result;
  }

  function normalizeOxyPIs(doc, indexed = false) {
    let oxyCounter = 0;
    const walk = (element) => {
      if (!element || element.nodeType !== 1) return;
      const processed = processOxyNodes(Array.from(element.childNodes), doc, indexed ? () => oxyCounter++ : null);
      while (element.firstChild) element.removeChild(element.firstChild);
      for (const child of processed) {
        element.appendChild(child);
        walk(child);
      }
    };
    if (doc.documentElement) walk(doc.documentElement);
  }

  function collectOxyTrackedChanges(text) {
    const changes = [];
    let m;
    const insertRe = /<\?oxy_insert_start\b([\s\S]*?)\?>([\s\S]*?)<\?oxy_insert_end\b[\s\S]*?\?>/g;
    while ((m = insertRe.exec(text))) {
      const attrs = parseOxyPIAttrs(m[1]);
      changes.push({ type: 'insert', author: attrs.author || '', timestamp: attrs.timestamp || '', content: stripOxyTags(m[2]).trim().slice(0, 300), index: m.index, matchLength: m[0].length, keepContent: m[2] });
    }
    const deleteRe = /<\?oxy_delete\b([\s\S]*?)\?>/g;
    while ((m = deleteRe.exec(text))) {
      const attrs = parseOxyPIAttrs(m[1]);
      changes.push({ type: 'delete', deletedContent: attrs.content || '', author: attrs.author || '', timestamp: attrs.timestamp || '', content: (attrs.content || '').trim().slice(0, 300), index: m.index, matchLength: m[0].length });
    }
    const commentRe = /<\?oxy_comment_start\b([\s\S]*?)\?>([\s\S]*?)<\?oxy_comment_end\b[\s\S]*?\?>/g;
    while ((m = commentRe.exec(text))) {
      const attrs = parseOxyPIAttrs(m[1]);
      changes.push({ type: 'comment', author: attrs.author || '', timestamp: attrs.timestamp || '', content: attrs.comment || '', context: stripOxyTags(m[2]).trim().slice(0, 300), index: m.index, matchLength: m[0].length, keepContent: m[2] });
    }
    changes.sort((a, b) => a.index - b.index);
    return changes;
  }


  const api = { normalizeOxyPIs, collectOxyTrackedChanges };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaOxygenCore = api;
})(typeof window === 'undefined' ? globalThis : window);
