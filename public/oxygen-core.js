// @ts-check
'use strict';
(function (root) {

  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  /** @type {Readonly<Record<string, string>>} */
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  /** @param {string} value */
  function decodeEntities(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, /** @type {string} */ key) => {
      if (key[0] === '#') {
        const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
      }
      return entities[key] ?? entity;
    });
  }
  /** @param {string} data */
  function parseOxyPIAttrs(data) {
    /** @type {Record<string, string | undefined>} */
    const attrs = {};
    const re = /([\w:.-]+)\s*=\s*(["'])([^]*?)\2/g;
    let match;
    while ((match = re.exec(data || ''))) attrs[match[1]] = decodeEntities(match[3]);
    return attrs;
  }
  /** @param {string} text */
  function readable(text) {
    return xml.scan(text).filter(t => t.kind === 'text' || t.kind === 'cdata').map(t =>
      t.kind === 'cdata' ? text.slice(t.start + 9, t.end - 3) : decodeEntities(text.slice(t.start, t.end))).join('');
  }

  /** @param {Node} node @param {string} [target] @returns {node is ProcessingInstruction} */
  function isInstruction(node, target) {
    return node.nodeType === 7 && (target === undefined || /** @type {ProcessingInstruction} */ (node).target === target);
  }

  /** @param {readonly Node[]} nodes @param {Document} doc @param {(() => number) | null} getIndex @returns {Node[]} */
  function processOxyNodes(nodes, doc, getIndex) {
    const result = [];
    let i = 0;
    while (i < nodes.length) {
      const child = nodes[i];
      if (isInstruction(child, 'oxy_insert_start')) {
        const attrs = parseOxyPIAttrs(child.data);
        const ins = doc.createElement('ins');
        ins.setAttribute('class', 'oxy-insert');
        if (getIndex) ins.setAttribute('data-oxy-index', String(child.oxyReviewIndex ?? getIndex()));
        if (attrs.author) ins.setAttribute('data-author', attrs.author);
        if (attrs.timestamp) ins.setAttribute('data-timestamp', attrs.timestamp);
        i++;
        const inner = [];
        while (i < nodes.length && !isInstruction(nodes[i], 'oxy_insert_end')) {
          inner.push(nodes[i]);
          i++;
        }
        i++;
        for (const n of processOxyNodes(inner, doc, getIndex)) ins.appendChild(n);
        result.push(ins);
        continue;
      }
      if (isInstruction(child, 'oxy_delete')) {
        const attrs = parseOxyPIAttrs(child.data);
        const del = doc.createElement('del');
        del.setAttribute('class', 'oxy-delete');
        if (getIndex) del.setAttribute('data-oxy-index', String(child.oxyReviewIndex ?? getIndex()));
        if (attrs.author) del.setAttribute('data-author', attrs.author);
        if (attrs.timestamp) del.setAttribute('data-timestamp', attrs.timestamp);
        del.textContent = readable(attrs.content || '');
        result.push(del);
        i++;
        continue;
      }
      if (isInstruction(child, 'oxy_comment_start')) {
        const attrs = parseOxyPIAttrs(child.data);
        const span = doc.createElement('span');
        span.setAttribute('class', 'oxy-comment');
        if (getIndex) span.setAttribute('data-oxy-index', String(child.oxyReviewIndex ?? getIndex()));
        if (attrs.author) span.setAttribute('data-author', attrs.author);
        if (attrs.comment) span.setAttribute('data-comment', attrs.comment);
        if (attrs.timestamp) span.setAttribute('data-timestamp', attrs.timestamp);
        i++;
        const inner = [];
        while (i < nodes.length && !isInstruction(nodes[i], 'oxy_comment_end')) {
          inner.push(nodes[i]);
          i++;
        }
        i++;
        for (const n of processOxyNodes(inner, doc, getIndex)) span.appendChild(n);
        result.push(span);
        continue;
      }
      if (child.nodeType === 7) { i++; continue; }
      result.push(child);
      i++;
    }
    return result;
  }

  /** @param {Document} doc */
  function normalizeOxyPIs(doc, indexed = false) {
    let oxyCounter = 0;
    // Assign indexes in source order before wrappers move children around.
    /** @param {Node} node */
    function index(node) {
      if (isInstruction(node) && ['oxy_insert_start', 'oxy_delete', 'oxy_comment_start'].includes(node.target)) node.oxyReviewIndex = oxyCounter++;
      for (const child of Array.from(node.childNodes || [])) index(child);
    }
    index(doc.documentElement); oxyCounter = 0;
    /** @param {Node} element */
    const walk = element => {
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

  /** @param {string} text @param {(token: import('./data-contracts').XmlSourceToken) => boolean} [ignoreUnpaired] */
  function collectOxyTrackedChanges(text, ignoreUnpaired) {
    /** @type {import('./data-contracts').OxygenChange[]} */
    const changes = [];
    /** @type {{name: string, attrs: ReturnType<typeof parseOxyPIAttrs>, token: import('./data-contracts').XmlSourceToken}[]} */
    const open = [];
    /** @param {import('./data-contracts').XmlSourceToken} token @param {string} message */
    function unpaired(token, message) {
      if (!ignoreUnpaired?.(token)) {
        throw Object.assign(new Error(message), { location: { source: text, start: token.start, end: token.end } });
      }
    }
    for (const token of xml.scan(text)) {
      if (token.kind !== 'pi') continue;
      const raw = text.slice(token.start, token.end), match = /^<\?(oxy_[\w]+)(?=\s|\?>)([^]*?)\?>$/.exec(raw);
      if (!match) continue;
      const name = match[1], attrs = parseOxyPIAttrs(match[2]);
      if (['oxy_insert_start', 'oxy_comment_start'].includes(name)) {
        open.push({ name, attrs, token }); continue;
      }
      if (['oxy_insert_end', 'oxy_comment_end'].includes(name)) {
        const startName = name.replace('_end', '_start');
        const at = open.findLastIndex(item => item.name === startName && (!attrs.mid || item.attrs.mid === attrs.mid));
        if (at < 0) {
          unpaired(token, 'Oxygen 修订结束标记没有对应起点');
          continue;
        }
        const start = open.splice(at, 1)[0], keepContent = text.slice(start.token.end, token.start), info = start.attrs;
        changes.push({ type: name === 'oxy_insert_end' ? 'insert' : 'comment', id: info.id,
          author: info.author || '', timestamp: info.timestamp || '', content: name === 'oxy_insert_end' ? readable(keepContent) : info.comment || '',
          context: name === 'oxy_comment_end' ? readable(keepContent) : undefined,
          index: start.token.start, matchLength: token.end - start.token.start, keepContent });
      } else if (name === 'oxy_delete') {
        changes.push({ type: 'delete', id: attrs.id, deletedContent: attrs.content || '', author: attrs.author || '', timestamp: attrs.timestamp || '',
          content: readable(attrs.content || ''), index: token.start, matchLength: token.end - token.start });
      }
    }
    for (const { token } of open) unpaired(token, 'Oxygen 修订起始标记没有对应终点');
    return changes.sort((a, b) => a.index - b.index);
  }
  /** @param {string} text */
  function hasUnsupportedChanges(text) {
    return xml.scan(text).some(token => {
      if (token.kind !== 'pi') return false;
      const raw = text.slice(token.start, token.end);
      return /^<\?oxy_(?:attributes|insert_marker|delete_marker)(?=\s|\?>)/.test(raw) ||
        /^<\?oxy_insert_start(?=\s|\?>)/.test(raw) && Boolean(parseOxyPIAttrs(raw).type) ||
        /^<\?oxy_comment_start(?=\s|\?>)/.test(raw) && Boolean(parseOxyPIAttrs(raw).parentID);
    });
  }


  const api = { normalizeOxyPIs, collectOxyTrackedChanges, parseOxyPIAttrs, decodeEntities, hasUnsupportedChanges };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaOxygenCore = api;
})(typeof window === 'undefined' ? globalThis : window);
