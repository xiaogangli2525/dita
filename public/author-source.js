'use strict';
(function (root) {
  const { parseXml, parseSource, serializeXmlNode, cloneDitaNode, elementChildren, xmlNodePath } = typeof module !== 'undefined' ? require('./xml-dom') : root.DitaXmlDom;
  const { createAuthorTopic } = typeof module !== 'undefined' ? require('./author-renderer') : root.DitaAuthorRenderer;
  const presentation = typeof module !== 'undefined' ? require('./document-presentation') : root.DitaDocumentPresentation;
  const { decode } = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const BODY_TAGS = presentation.bodies;

  const VISUAL_TO_DITA = new Map(Object.entries({
    h1: 'title', h2: 'title', h3: 'title', h4: 'title', h5: 'title', h6: 'title',
    p: 'p', ol: 'ol', ul: 'ul', li: 'li', pre: 'pre', table: 'table', image: 'image',
    span: 'ph', div: 'p', a: 'xref', strong: 'b', em: 'i'
  }));

  function visualElementToDita(node, documentRef, preserveAttributes = false) {
    const converted = convertVisualElement(node, documentRef, preserveAttributes);
    if (converted) {
      if (preserveAttributes) {
        const inert = JSON.parse(node.getAttribute('data-dita-inert-attrs') || '{}');
        for (const [name, value] of Object.entries(inert)) converted.setAttribute(name, value);
      }
      converted.ditaSourcePath = node.ditaSourcePath;
      converted.ditaVisualNode = node;
    }
    return converted;
  }

  function convertVisualElement(node, documentRef, preserveAttributes = false) {
    if (node.nodeType !== 1) return null;
    const sourceTag = node.localName.toLowerCase();
    const ditaTag = VISUAL_TO_DITA.get(sourceTag) || sourceTag;
    const sourceTagAttribute = node.getAttribute?.('data-dita-source');
    if (!sourceTagAttribute && sourceTag === 'br') return documentRef.createTextNode('\n');
    if ((sourceTagAttribute === 'fn' || sourceTagAttribute === 'xref' && node.getAttribute('type') === 'fn') && node.getAttribute('data-dita-original')) {
      return parseXml(node.getAttribute('data-dita-original')).documentElement;
    }
    if (sourceTagAttribute === 'image' && node.getAttribute('data-dita-original')) {
      const image = parseXml(node.getAttribute('data-dita-original')).documentElement;
      const alt = Array.from(image.children).find(child => child.localName === 'alt');
      for (const attr of Array.from(node.attributes)) {
        if (attr.name === 'data-dita-href') image.setAttribute('href', attr.value);
        else if (attr.name === 'alt') { if (alt) { if (alt.textContent !== attr.value) alt.textContent = attr.value; } else if (image.hasAttribute('alt') || attr.value) image.setAttribute('alt', attr.value); }
        else if (!['src', 'class', 'style', 'contenteditable'].includes(attr.name) && !attr.name.startsWith('data-')) image.setAttribute(attr.name, attr.value);
      }
      return image;
    }
    if (sourceTagAttribute === 'table' && sourceTag === 'div') {
      let table = null;
      const original = node.getAttribute('data-dita-original');
      if (original) {
        try { table = parseXml(original).documentElement; } catch { table = null; }
      }
      if (!table) table = documentRef.createElement('table');
      for (const attribute of Array.from(node.attributes || [])) {
        if (!['class', 'style', 'contenteditable'].includes(attribute.name) && !attribute.name.startsWith('data-')) table.setAttribute(attribute.name, attribute.value);
      }
      const htmlTable = Array.from(node.children || []).find(child => child.localName === 'table');
      if (htmlTable) {
        const rows = Array.from(htmlTable.querySelectorAll('tr'));
        let tgroup = Array.from(table.childNodes).find(child => child.localName === 'tgroup');
        if (!tgroup) {
          tgroup = documentRef.createElement('tgroup');
          tgroup.setAttribute('cols', String(rows.reduce((max, row) => Math.max(max, row.children.length), 0) || 1));
          table.appendChild(tgroup);
        }
        const sections = new Map();
        for (const child of Array.from(tgroup.childNodes)) {
          if (child.localName === 'thead' || child.localName === 'tbody') {
            sections.set(child.localName, child);
            for (const row of Array.from(child.childNodes)) {
              if (row.localName === 'row') child.removeChild(row);
            }
          }
        }
        for (const htmlRow of rows) {
          const sectionName = htmlRow.getAttribute('data-dita-section') === 'thead' || Array.from(htmlRow.children).some(cell => cell.localName === 'th') ? 'thead' : 'tbody';
          let section = sections.get(sectionName);
          if (!section) {
            section = documentRef.createElement(sectionName);
            tgroup.appendChild(section);
            sections.set(sectionName, section);
          }
          const row = documentRef.createElement('row');
          row.ditaSourcePath = htmlRow.ditaSourcePath;
          row.ditaVisualNode = htmlRow;
          try {
            const attrs = JSON.parse(htmlRow.getAttribute('data-dita-row-attrs') || '{}');
            for (const [name, value] of Object.entries(attrs)) row.setAttribute(name, value);
          } catch { /* Keep editing if visual metadata is malformed. */ }
          for (const htmlCell of Array.from(htmlRow.children)) {
            const entry = documentRef.createElement('entry');
            entry.ditaSourcePath = htmlCell.ditaSourcePath;
            entry.ditaVisualNode = htmlCell;
            try {
              const attrs = JSON.parse(htmlCell.getAttribute('data-dita-entry-attrs') || '{}');
              for (const [name, value] of Object.entries(attrs)) entry.setAttribute(name, value);
            } catch { /* Ignore malformed visual metadata and keep cell text. */ }
            for (const child of htmlCell.childNodes || []) {
              if (child.nodeType === 3) entry.appendChild(documentRef.createTextNode(child.data));
              else {
                const converted = visualElementToDita(child, documentRef, true);
                if (converted) entry.appendChild(converted);
              }
            }
            row.appendChild(entry);
          }
          section.appendChild(row);
        }
      }
      const visualTitle = Array.from(node.children || []).find(child => child.localName === 'h3');
      if (visualTitle) {
        const title = Array.from(table.childNodes).find(child => child.localName === 'title');
        const converted = visualElementToDita(visualTitle, documentRef, true);
        if (title) title.replaceWith(converted); else table.insertBefore(converted, table.firstChild);
      }
      return table;
    }
    const element = documentRef.createElement(sourceTagAttribute || ditaTag);
    if (preserveAttributes) {
      for (const attribute of Array.from(node.attributes || [])) {
        const name = attribute.name.toLowerCase();
        if (name === 'data-dita-href' && sourceTagAttribute === 'image') {
          element.setAttribute('href', attribute.value);
          continue;
        }
        if (name === 'src' && sourceTagAttribute === 'image') continue;
        if (!['class', 'style', 'contenteditable'].includes(name) && !name.startsWith('data-dita-')) element.setAttribute(attribute.name, attribute.value);
      }

    }
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        element.appendChild(documentRef.createTextNode(child.data));
        continue;
      }
      const converted = visualElementToDita(child, documentRef, true);
      if (converted) element.appendChild(converted);
    }
    return element;
  }

  function updateDitaBody(root, visualContainer, document) {
    const sourceBody = BODY_TAGS.has(root.localName)
      ? root
      : Array.from(root.childNodes).find(node => BODY_TAGS.has(node.localName));
    const bodyName = { topic: 'body', concept: 'conbody', reference: 'refbody', task: 'taskbody' }[root.localName];
    if (!sourceBody && !bodyName) throw new Error(`No DITA body found in <${root.localName}>`);
    const bodyClone = sourceBody ? cloneDitaNode(sourceBody, document) : document.createElement(bodyName);
    const sourceTitle = Array.from(root.childNodes).find(node => node.localName === 'title');
    const visualTitle = Array.from(visualContainer.childNodes).find(node => node.localName === 'h2');
    const bodyContent = Array.from(visualContainer.childNodes).find(node => node.localName === 'div' && node.hasAttribute('data-dita-body'));
    const sourceSummary = Array.from(root.childNodes).find(node => node.localName === 'shortdesc');
    const summaries = Array.from(visualContainer.childNodes).filter(node => node.getAttribute?.('data-dita-source') === 'shortdesc');
    if (summaries.length > 1) throw new Error('摘要不能拆成多个摘要，请在正文中添加段落');
    if (!visualTitle || !bodyContent) throw new Error('Visual editor is missing its editable title or body');
    if (Array.from(visualContainer.childNodes).filter(node => node.localName === 'h2').length !== 1) throw new Error('标题不能拆成多行，请撤销此操作后继续编辑');

    const titleElement = visualElementToDita(visualTitle, document, true);
    if (sourceTitle) sourceTitle.replaceWith(titleElement);
    else root.insertBefore(titleElement, root.firstChild);
    if (summaries.length) {
      const summary = visualElementToDita(summaries[0], document, true);
      if (sourceSummary) sourceSummary.replaceWith(summary);
      else root.insertBefore(summary, titleElement.nextSibling);
    } else sourceSummary?.remove();

    const newContent = [];
    for (const node of bodyContent.childNodes) {
      if (node.nodeType === 1 && node.hasAttribute('data-dita-placeholder') && !node.textContent.trim() && !node.querySelector('img,.fn-ref') && bodyContent.children.length === 1) continue;
      if (node.nodeType === 3 && node.data.trim()) {
        const paragraph = document.createElement('p');
        paragraph.appendChild(document.createTextNode(node.data));
        paragraph.ditaSourcePath = node.ditaSourcePath;
        paragraph.ditaVisualNode = node;
        newContent.push(paragraph);
        continue;
      }
      const converted = visualElementToDita(node, document, true);
      if (converted) newContent.push(converted);
    }
    bodyClone.replaceChildren(...newContent);
    if (!sourceBody) {
      if (newContent.length) root.insertBefore(bodyClone, Array.from(root.childNodes).find(node => node.localName === 'related-links' || ['topic', 'concept', 'task', 'reference'].includes(node.localName)) || null);
    } else if (sourceBody !== root) sourceBody.replaceWith(bodyClone);
    else root.replaceChildren(...Array.from(root.childNodes).filter(node => node !== sourceBody), bodyClone);
    return root;
  }

  // Adapt the canonical XML source tree to the patcher's element ranges.
  function sourceRanges(node) {
    const gaps = [[]];
    for (const child of node.children) {
      if (child.kind === 'element') gaps.push([]);
      else gaps.at(-1).push(child);
    }
    return { start: node.start, openEnd: node.end, closeStart: node.close?.start ?? node.end,
      end: node.close?.end ?? node.end, gaps,
      children: node.children.filter(child => child.kind === 'element').map(sourceRanges) };
  }

  function authorSignature(node) {
    function parts(current, preserveSpace = false) {
      if (current.nodeType === 3 || current.nodeType === 4) return preserveSpace || current.data.trim() ? current.data.replace(/\r\n?/g, '\n') : null;
      if (current.nodeType !== 1) return null;
      const attrs = Array.from(current.attributes || []).map(attr => [attr.name, attr.value]).sort();
      const exact = preserveSpace || presentation.preformatted.has(current.localName) || current.getAttribute('xml:space') === 'preserve';
      return [current.localName, attrs, Array.from(current.childNodes).map(child => parts(child, exact)).filter(child => child !== null)];
    }
    return JSON.stringify(parts(node));
  }

  function textGaps(node) {
    const gaps = [''];
    for (const child of node.childNodes) {
      if (child.nodeType === 1) gaps.push('');
      else if (child.nodeType === 3 || child.nodeType === 4) gaps[gaps.length - 1] += child.data;
    }
    return gaps;
  }

  function serializeAuthorEdits(root, original, projected, range, source) {
    const originalByPath = new Map();
    const projectedByPath = new Map();
    function indexNodes(node, map) {
      map.set(node.ditaSourcePath ?? xmlNodePath(node), node);
      for (const child of elementChildren(node)) indexNodes(child, map);
    }
    indexNodes(original, originalByPath);
    indexNodes(projected, projectedByPath);
    const normalizeText = text => text.replace(/\r\n?/g, '\n');
    const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';

    function patchGap(gap, next, previous, tokens, start) {
      const escaped = text => escapeText(text).replace(/\r?\n/g, newline);
      const trivia = tokens.filter(token => token.kind === 'pi' || token.kind === 'comment');
      if (!trivia.length) return escaped(next);
      // Retain annotations at their original source positions. A minimal text
      // edit must not move both ends of an Oxygen comment behind the new text.
      if (tokens.some(token => token.kind === 'cdata')) throw new Error('文字同时包含 CDATA 和批注标记，请使用源码修改');
      const chars = [];
      for (const token of tokens.filter(token => token.kind === 'text')) {
        for (let offset = token.start; offset < token.end;) {
          const begin = offset;
          let text;
          if (source[offset] === '&') {
            offset = source.indexOf(';', offset) + 1;
            text = decode(source.slice(begin, offset));
          } else {
            text = String.fromCodePoint(source.codePointAt(offset)); offset += text.length;
            if (text === '\r') { if (source[offset] === '\n') offset++; text = '\n'; }
          }
          chars.push({ text, start: begin, end: offset });
        }
      }
      if (chars.map(char => char.text).join('') !== normalizeText(previous)) throw new Error('批注文本的空白结构较复杂，请使用源码修改');
      const changed = Array.from(normalizeText(next));
      let first = 0, tail = 0;
      while (first < chars.length && first < changed.length && chars[first].text === changed[first]) first++;
      while (tail < chars.length - first && tail < changed.length - first && chars[chars.length - 1 - tail].text === changed[changed.length - 1 - tail]) tail++;
      const insertion = first === chars.length ? start + gap.length : first === 0 ? start : chars[first].start;
      const begin = first === chars.length - tail ? insertion : chars[first].start;
      const end = first === chars.length - tail ? begin : chars[chars.length - tail - 1].end;
      if (trivia.some(token => token.start < end && token.end > begin)) throw new Error('修改跨过批注或修订标记，请分段修改或使用源码');
      return source.slice(start, begin) + escaped(changed.slice(first, changed.length - tail).join('')) + source.slice(end, start + gap.length);
    }

    function serialize(node, oldNode, span) {
      if (!oldNode || !span) return serializeXmlNode(node).replace(/\r?\n/g, newline);
      const oldProjection = projectedByPath.get(xmlNodePath(oldNode)) || oldNode;
      if (authorSignature(node) === authorSignature(oldProjection)) return source.slice(span.start, span.end);
      const newChildren = elementChildren(node);
      const oldChildren = elementChildren(oldNode);
      const oldGaps = [];
      let cursor = span.openEnd;
      for (const childSpan of span.children) {
        oldGaps.push(source.slice(cursor, childSpan.start));
        cursor = childSpan.end;
      }
      oldGaps.push(source.slice(cursor, span.closeStart));
      const newGaps = textGaps(node);
      const projectionGaps = textGaps(oldProjection);
      const used = new Set();
      const matches = newChildren.map(() => -1);
      // Reserve identities before matching new elements. Otherwise an inserted
      // paragraph could consume the source span belonging to the next paragraph.
      const matchPass = find => newChildren.forEach((child, index) => {
        if (matches[index] >= 0) return;
        const match = find(child);
        if (match && oldChildren.includes(match) && !used.has(match)) {
          used.add(match);
          matches[index] = oldChildren.indexOf(match);
        }
      });
      matchPass(child => originalByPath.get(child.ditaSourcePath));
      matchPass(child => child.getAttribute('id') && oldChildren.find(item => !used.has(item) && item.localName === child.localName && item.getAttribute('id') === child.getAttribute('id')));
      matchPass(child => oldChildren.find(item => !used.has(item) && item.localName === child.localName && authorSignature(child) === authorSignature(projectedByPath.get(xmlNodePath(item)) || item)));
      matchPass(child => oldChildren.find(item => !used.has(item) && item.localName === child.localName));
      // Comments and processing instructions outside deleted elements remain
      // part of the source, even though Author does not expose them as blocks.
      const triviaPattern = /<!--[^]*?-->|<\?[^]*?\?>/g;
      const retainedTrivia = oldGaps.map((gap, index) => {
        if (matches.includes(index) || index >= oldChildren.length) return '';
        const trivia = gap.match(triviaPattern) || [];
        if (!trivia.length) return '';
        return gap.replace(triviaPattern, '').trim() ? trivia.join('') : gap.replace(/\r?\n[ \t]*$/, '');
      });
      const takeTriviaBefore = limit => retainedTrivia.map((trivia, index) => {
        if (index >= limit) return '';
        retainedTrivia[index] = '';
        return trivia;
      }).join('');
      const blockContent = (oldChildren.length > 0 || newChildren.length > 0) && newGaps.every(text => !text.trim()) && projectionGaps.every(text => !text.trim());
      const defaultGap = oldGaps.find(gap => !gap.trim() && /\n/.test(gap)) || '';
      let inner = '';
      for (let index = 0; index < newChildren.length; index++) {
        const oldIndex = matches[index];
        if (oldIndex >= 0) inner += takeTriviaBefore(oldIndex);
        const gap = oldIndex >= 0 ? oldGaps[oldIndex] : defaultGap;
        const oldText = oldIndex >= 0 ? projectionGaps[oldIndex] || '' : '';
        if (blockContent || normalizeText(newGaps[index]) === normalizeText(oldText)) inner += gap;
        else inner += patchGap(gap, newGaps[index], oldText, oldIndex >= 0 ? span.gaps[oldIndex] : [], oldIndex > 0 ? span.children[oldIndex - 1].end : span.openEnd);
        inner += serialize(newChildren[index], oldChildren[oldIndex], span.children[oldIndex]);
      }
      inner += takeTriviaBefore(Infinity);
      const tail = oldGaps[oldGaps.length - 1];
      if (blockContent || normalizeText(newGaps[newGaps.length - 1]) === normalizeText(projectionGaps[projectionGaps.length - 1] || '')) inner += tail;
      else inner += patchGap(tail, newGaps[newGaps.length - 1], projectionGaps[projectionGaps.length - 1] || '', span.gaps.at(-1), span.children.at(-1)?.end ?? span.openEnd);
      const attrs = element => JSON.stringify(Array.from(element.attributes || []).map(attr => [attr.name, attr.value]).sort());
      let open = node.localName === oldNode.localName && attrs(node) === attrs(oldProjection) ? source.slice(span.start, span.openEnd) : serializeXmlNode(node.cloneNode(false));
      if (/\/\s*>$/.test(open)) {
        if (!inner) return open;
        open = open.replace(/\/\s*>$/, '>');
      }
      return open + inner + (node.localName === oldNode.localName && source.slice(span.closeStart, span.end) || `</${node.localName}>`);
    }
    const result = source.slice(0, range.start) + serialize(root, original, range) + source.slice(range.end);
    // The live visual DOM survives typing. Rebase its node identities after
    // deletions/insertions so the next keystroke still patches the right node.
    function rebase(node) {
      if (node.ditaVisualNode) node.ditaVisualNode.ditaSourcePath = xmlNodePath(node);
      for (const child of elementChildren(node)) rebase(child);
    }
    rebase(root);
    return result;
  }

  function updateSource(source, visualEditor) {
    const { document: doc, tree } = parseSource(source);
    const root = doc.documentElement.cloneNode(true);
    const projected = doc.documentElement.cloneNode(true);
    updateDitaBody(projected, createAuthorTopic(source, doc, false, '', doc), doc);
    updateDitaBody(root, visualEditor, doc);
    return serializeAuthorEdits(root, doc.documentElement, projected, sourceRanges(tree), source);
  }


  const api = { VISUAL_TO_DITA, visualElementToDita, updateDitaBody, updateSource };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAuthorSource = api;
})(typeof window === 'undefined' ? globalThis : window);
