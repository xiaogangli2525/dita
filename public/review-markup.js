'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const blockSelector = 'p,li,pre,tr,dt,dd,h2,h3,h4,h5,h6,[data-dita-source="note"],[data-dita-source="table"],[data-dita-source="section"],[data-dita-source="example"],[data-dita-source="fig"],ul,ol,dl';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  // Raw XML offsets and visible offsets differ for entities, CDATA, CRLF and
  // collapsed prose whitespace. Each displayed UTF-16 unit keeps its source
  // interval; a partial entity change therefore highlights the whole glyph.
  function textUnits(source, token, text) {
    const start = token.start + (token.kind === 'cdata' ? 9 : 0);
    const end = token.end - (token.kind === 'cdata' ? 3 : 0);
    const raw = source.slice(start, end), units = [];
    const expression = token.kind === 'cdata' ? /\r\n|[\s\S]/g : /&(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);|\r\n|[\s\S]/gi;
    for (const match of raw.matchAll(expression)) {
      const value = match[0];
      const entity = value[0] === '&' && value.endsWith(';') ? value.slice(1, -1) : '';
      const decoded = entity ? entities[entity] ?? String.fromCodePoint(entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))) : value.replace(/\r\n?/g, '\n');
      for (let i = 0; i < decoded.length; i++) units.push({ value: decoded[i], start: start + match.index, end: start + match.index + value.length });
    }
    if (units.map(unit => unit.value).join('') === text.data) return units;
    const collapsed = [];
    for (const unit of units) {
      if (/\s/.test(unit.value)) {
        if (collapsed.at(-1)?.value === ' ') collapsed.at(-1).end = unit.end;
        else collapsed.push({ ...unit, value: ' ' });
      } else collapsed.push(unit);
    }
    return collapsed.map(unit => unit.value).join('') === text.data ? collapsed : [];
  }

  function projection(source, surface) {
    const tree = xml.inspectSource(source), elements = [], texts = [];
    const nodes = new Map(Array.from(surface.querySelectorAll('*'), node => [node.ditaSourcePath, node]));
    const textNodes = new Map();
    const walker = surface.ownerDocument.createTreeWalker(surface, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.ditaSourceTextPath !== undefined) textNodes.set(node.ditaSourceTextPath, node);
    }
    function visit(item, path, parent) {
      const element = { ...item, node: nodes.get(path), parent, end: item.close?.end ?? item.end };
      elements.push(element);
      let childIndex = 0, textIndex = 0;
      for (const child of item.children) {
        if (child.kind === 'element') visit(child, path ? path + '/' + childIndex++ : String(childIndex++), element);
        else if (child.kind === 'text' || child.kind === 'cdata') {
          const node = textNodes.get(path + ':' + textIndex++);
          if (!node) continue;
          const units = textUnits(source, child, node);
          if (units.length) texts.push({ ...child, node, units, parent: element });
        }
      }
    }
    visit(tree, '', null);
    return { elements, texts };
  }

  function visibleRange(token, start, end) {
    const from = token.units.findIndex(unit => unit.end > start);
    if (from < 0 || token.units[from].start >= end) return null;
    let to = from + 1;
    while (to < token.units.length && token.units[to].start < end) to++;
    return { from, to };
  }

  function clear(surface) {
    for (const ghost of surface.querySelectorAll('[data-review-ghost]')) ghost.remove();
    for (const wrapper of surface.querySelectorAll('[data-review-decoration]')) {
      if (wrapper.ditaReviewOriginal) wrapper.replaceWith(wrapper.ditaReviewOriginal);
    }
  }

  function create({ source, baseline, surface, createAuthorTopic }) {
    const documentRef = surface.ownerDocument;
    const current = projection(source, surface);
    // The baseline is never attached to a browsing context: rendering it must
    // not fetch its images just to calculate a text-only review projection.
    const previous = projection(baseline, createAuthorTopic(baseline, documentRef.implementation.createHTMLDocument(''), true));
    const operations = new Map();
    function operation(token) {
      if (!operations.has(token)) operations.set(token, { insertions: [], deletions: [] });
      return operations.get(token);
    }
    function marker(type, value) {
      const node = documentRef.createElement(type === 'old' ? 'del' : 'ins');
      node.dataset.reviewText = type;
      node.textContent = value;
      node.title = type === 'old' ? '待审阅：删除的内容' : '待审阅：新增的内容';
      return node;
    }

    function deletedBlock(element, offset, anchor) {
      const ghost = element.node.cloneNode(true);
      ghost.dataset.reviewGhost = 'true';
      ghost.classList.add('review-deleted-block');
      ghost.title = '待审阅：删除的内容';
      for (const node of [ghost, ...ghost.querySelectorAll('*')]) {
        for (const attribute of Array.from(node.attributes)) {
          if (/^(?:id|tabindex|role|href|data-fn.*|data-oxy-index|data-dita-original)$/.test(attribute.name)) node.removeAttribute(attribute.name);
        }
        node.classList.remove('fn-ref');
        if (node.hasAttribute('contenteditable')) node.setAttribute('contenteditable', 'false');
      }
      // A deleted row belongs in its original table section; a paragraph
      // belongs beside its siblings, rather than inside the following cell.
      let parent = current.elements.filter(item => item.node && item.name === element.parent?.name && item.start <= offset && item.end >= offset).at(-1)?.node;
      if (!parent && ghost.matches('tr')) {
        const table = current.elements.filter(item => item.node?.matches('[data-dita-source="table"]') && item.start <= offset && item.end >= offset).at(-1)?.node.querySelector('table');
        if (table) {
          const sectionName = element.node.parentElement.tagName.toLowerCase();
          parent = table.querySelector(sectionName);
          if (!parent) { parent = documentRef.createElement(sectionName); table.append(parent); }
        }
      }
      if (parent) {
        const next = current.elements.find(item => item.node?.parentNode === parent && item.start >= offset)?.node;
        parent.insertBefore(ghost, next || null);
      } else {
        const next = current.texts.find(item => item.end > offset)?.node.parentElement;
        const previous = current.texts.findLast(item => item.start <= offset)?.node.parentElement;
        const sibling = (next || previous || anchor)?.closest(element.node.tagName.toLowerCase());
        if (sibling && sibling !== surface && surface.contains(sibling)) {
          if (next) sibling.before(ghost); else sibling.after(ghost);
        } else if (anchor && surface.contains(anchor)) anchor.prepend(ghost);
        else surface.append(ghost);
      }
      return ghost;
    }

    function mark({ start, end, oldStart, oldEnd, anchor }) {
      const additions = current.texts.filter(token => token.start < end && token.end > start).map(token => ({ token, range: visibleRange(token, start, end) })).filter(item => item.range);
      const removals = previous.texts.filter(token => token.start < oldEnd && token.end > oldStart).map(token => ({ token, range: visibleRange(token, oldStart, oldEnd) })).filter(item => item.range);
      const valueOf = items => items.map(({ token, range }) => token.node.data.slice(range.from, range.to)).join('');
      if (valueOf(additions) === valueOf(removals)) return [];
      for (const { token, range } of additions) operation(token).insertions.push(range);

      const fullBlocks = previous.elements.filter(item => item.node?.matches(blockSelector) && item.start >= oldStart && item.end <= oldEnd);
      const deleted = fullBlocks.filter(item => !fullBlocks.some(parent => parent !== item && parent.start <= item.start && parent.end >= item.end));
      const ghosts = deleted.map(item => deletedBlock(item, start, anchor));
      const remaining = removals.filter(({ token }) => !deleted.some(item => token.start >= item.start && token.end <= item.end));
      const removed = valueOf(remaining);
      if (!removed) return ghosts;

      // Prefer the text at the deletion boundary, including the preceding
      // token's end. This keeps deletions at the end of a bold/code span in it.
      let token = current.texts.find(item => item.start <= start && item.end >= start) || additions[0]?.token || current.texts.find(item => item.start >= start);
      if (token && anchor && !additions.length && !anchor.contains(token.node)) {
        token = current.texts.findLast(item => anchor.contains(item.node) && item.end <= start);
      }
      if (token) {
        const at = token.units.findIndex(unit => unit.end > start);
        operation(token).deletions.push({ at: at < 0 ? token.node.data.length : at, value: removed });
      } else if (anchor) {
        const deletion = marker('old', removed);
        deletion.dataset.reviewGhost = 'true';
        anchor.append(deletion);
        ghosts.push(deletion);
      }
      return ghosts;
    }

    function finish() {
      for (const [token, edits] of operations) {
        const text = token.node, wrapper = documentRef.createElement('span');
        wrapper.dataset.reviewDecoration = 'true';
        wrapper.ditaReviewOriginal = text;
        const points = new Set([0, text.data.length]);
        for (const range of edits.insertions) { points.add(range.from); points.add(range.to); }
        for (const deletion of edits.deletions) points.add(deletion.at);
        const offsets = Array.from(points).sort((a, b) => a - b);
        for (let i = 0; i < offsets.length; i++) {
          const at = offsets[i], next = offsets[i + 1];
          for (const deletion of edits.deletions.filter(item => item.at === at)) wrapper.append(marker('old', deletion.value));
          if (next === undefined || next === at) continue;
          const value = text.data.slice(at, next);
          wrapper.append(edits.insertions.some(range => range.from <= at && range.to >= next) ? marker('new', value) : documentRef.createTextNode(value));
        }
        text.replaceWith(wrapper);
      }
    }
    return { mark, finish };
  }

  const api = { create, clear };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReviewMarkup = api;
})(typeof window === 'undefined' ? globalThis : window);
