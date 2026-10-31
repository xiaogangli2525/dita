'use strict';
const xmlSource = typeof module !== 'undefined' ? require('./xml-source') : window.DitaXmlSource;

const BODY_TAGS = new Set(['body', 'conbody', 'refbody', 'taskbody']);
const INLINE_TAGS = new Set(['p', 'li', 'entry', 'dt', 'dd', 'note', 'title']);
const SKIP_TAGS = new Set(['topic', 'concept', 'reference', 'task', 'body', 'conbody', 'refbody', 'taskbody', 'shortdesc', 'section', 'example', 'fig', 'dl', 'dli']);
const VISUAL_TO_DITA = new Map(Object.entries({
  h1: 'title', h2: 'title', h3: 'title', h4: 'title', h5: 'title', h6: 'title',
  p: 'p', ol: 'ol', ul: 'ul', li: 'li', pre: 'pre', table: 'table', image: 'image'
}));

let _ctx = { topicPath: '', imageDataCache: new Map(), fnCounter: 0, mdFnCounter: 0, mdFootnotes: [] };
function resolveAssetPath(href, ctx) {
  ctx = ctx || _ctx;
  if (!href) return '';
  let raw = decodeURIComponent(href.split('?')[0].split('#')[0]);
  if (/^(https?:|data:|\/)/i.test(raw)) return raw;
  const topicDir = ctx.topicPath ? ctx.topicPath.replace(/[^\/]+$/, '') : '';
  const combined = topicDir + raw;
  const parts = combined.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.' && part !== '') result.push(part);
  }
  return result.join('/');
}

function stripDocType(text) {
  return text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/i, '');
}

function parseXml(text) {
  xmlSource.validateXml(text);
  const doc = new DOMParser().parseFromString(stripDocType(text), 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error(parserError.textContent.replace(/\s+/g, ' ').trim());
  return doc;
}

function serializeXmlNode(node) {
  if (node.localName === '#text') return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (node.nodeType === 3) return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (node.nodeType === 7) return `<?${node.target} ${node.data}?>`;
  const attributes = Array.from(node.attributes || []).map(attribute => ` ${attribute.name}="${String(attribute.value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('');
  if (!node.childNodes.length) return `<${node.localName}${attributes}/>`;
  return `<${node.localName}${attributes}>${Array.from(node.childNodes).map(serializeXmlNode).join('')}</${node.localName}>`;
}

function cloneDitaNode(node, documentRef) {
  if (node.nodeType === 3) { const text = documentRef.createTextNode(node.data); text.localName = '#text'; return text; }
  if (node.nodeType !== 1) return null;
  const clone = documentRef.createElement(node.localName);
  for (const attribute of Array.from(node.attributes || [])) clone.setAttribute(attribute.name, attribute.value);
  for (const child of node.childNodes) {
    const childClone = cloneDitaNode(child, documentRef);
    if (childClone) clone.appendChild(childClone);
  }
  return clone;
}

function visualElementToDita(node, documentRef, preserveAttributes = false) {
  const converted = convertVisualElement(node, documentRef, preserveAttributes);
  if (converted) {
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
  if (sourceTagAttribute === 'fn' && node.getAttribute('data-dita-original')) {
    return parseXml(node.getAttribute('data-dita-original')).documentElement;
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

function elementChildren(node) {
  return Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
}

function xmlNodePath(node) {
  const indexes = [];
  while (node?.parentNode?.nodeType === 1) {
    indexes.unshift(elementChildren(node.parentNode).indexOf(node));
    node = node.parentNode;
  }
  return indexes.join('/');
}

function updateDitaBody(root, visualContainer, document) {
  const sourceBody = BODY_TAGS.has(root.localName)
    ? root
    : Array.from(root.childNodes).find(node => BODY_TAGS.has(node.localName));
  if (!sourceBody) throw new Error(`No DITA body found in <${root.localName}>`);

  const bodyClone = cloneDitaNode(sourceBody, document);
  const sourceTitle = Array.from(root.childNodes).find(node => node.localName === 'title');
  const visualTitle = Array.from(visualContainer.childNodes).find(node => node.localName === 'h2');
  const bodyContent = Array.from(visualContainer.childNodes).find(node => node.localName === 'div' && node.hasAttribute('data-dita-body'));
  if (!visualTitle || !bodyContent) throw new Error('Visual editor is missing its editable title or body');

  const titleElement = visualElementToDita(visualTitle, document, true);
  if (sourceTitle) sourceTitle.replaceWith(titleElement);
  else root.insertBefore(titleElement, sourceBody);

  const newContent = [];
  for (const node of bodyContent.childNodes) {
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
  if (sourceBody !== root) sourceBody.replaceWith(bodyClone);
  else root.replaceChildren(...Array.from(root.childNodes).filter(node => node !== sourceBody), bodyClone);
  return root;
}

// DOMParser normalizes line endings and XMLSerializer rewrites quoting and
// whitespace. Keep source spans so Author edits patch the original document
// rather than serializing the entire topic again.
function xmlSourceRanges(source) {
  const stack = [];
  let root;
  for (let cursor = 0; cursor < source.length;) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    const terminator = source.startsWith('<!--', start) ? '-->'
      : source.startsWith('<![CDATA[', start) ? ']]>'
        : source.startsWith('<?', start) ? '?>' : '';
    if (terminator) {
      cursor = source.indexOf(terminator, start + 2) + terminator.length;
      continue;
    }
    let quote = '';
    let subset = 0;
    let end = start + 1;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '[') subset++;
      else if (char === ']') subset--;
      else if (char === '>' && subset === 0) break;
    }
    cursor = end + 1;
    if (source[start + 1] === '!') continue;
    if (source[start + 1] === '/') {
      const range = stack.pop();
      range.closeStart = start;
      range.end = cursor;
    } else {
      const range = { start, openEnd: cursor, closeStart: cursor, end: cursor, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(range);
      else root = range;
      if (!/\/\s*>$/.test(source.slice(start, cursor))) stack.push(range);
    }
  }
  return root;
}

function authorSignature(node) {
  function parts(current, preserveSpace = false) {
    if (current.nodeType === 3 || current.nodeType === 4) return preserveSpace || current.data.trim() ? current.data.replace(/\r\n?/g, '\n') : null;
    if (current.nodeType !== 1) return null;
    const attrs = Array.from(current.attributes || []).map(attr => [attr.name, attr.value]).sort();
    const exact = preserveSpace || ['codeblock', 'pre'].includes(current.localName) || current.getAttribute('xml:space') === 'preserve';
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
      else inner += escapeText(newGaps[index]).replace(/\r?\n/g, newline) + (gap.match(/<!--[^]*?-->|<\?[^]*?\?>/g) || []).join('');
      inner += serialize(newChildren[index], oldChildren[oldIndex], span.children[oldIndex]);
    }
    inner += takeTriviaBefore(Infinity);
    const tail = oldGaps[oldGaps.length - 1];
    if (blockContent || normalizeText(newGaps[newGaps.length - 1]) === normalizeText(projectionGaps[projectionGaps.length - 1] || '')) inner += tail;
    else inner += escapeText(newGaps[newGaps.length - 1]).replace(/\r?\n/g, newline) + (tail.match(/<!--[^]*?-->|<\?[^]*?\?>/g) || []).join('');
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

function updateCurrentFromVisual(state, dom, source) {
  const doc = parseXml(source);
  const root = doc.documentElement.cloneNode(true);
  const projected = doc.documentElement.cloneNode(true);
  updateDitaBody(projected, createAuthorTopic(source, doc), doc);
  updateDitaBody(root, dom.visualEditor, doc);
  return serializeAuthorEdits(root, doc.documentElement, projected, xmlSourceRanges(source), source);
}

function updateVisualFromXml(state, dom, source, documentRef = document, normalizeOxy = false, topicPath = '') {
  const doc = parseXml(source);
  const root = doc.documentElement;
  const container = createAuthorTopic(source, documentRef, normalizeOxy, topicPath);
  dom.visualEditor.replaceChildren(...container.childNodes);
  dom.visualEditor.ditaSourceContent = source;
}


function resetFnCounter() { _ctx.fnCounter = 0; }
function authorHeading(node, documentRef, tag = 'h3') {
  const heading = documentRef.createElement(tag);
  heading.ditaSourcePath = xmlNodePath(node);
  for (const attr of Array.from(node.attributes || [])) heading.setAttribute(attr.name, attr.value);
  for (const child of node.childNodes) { const rendered = renderDitaNode(child, documentRef); if (rendered) heading.appendChild(rendered); }
  return heading;
}
function createAuthorTopic(source, documentRef = document, normalizeOxy = false, topicPath = '') {
  _ctx.topicPath = topicPath;
  resetFnCounter();
  const doc = parseXml(source);
  if (normalizeOxy) normalizeOxyPIs(doc, true);
  const root = doc.documentElement;
  const container = documentRef.createElement('article');
  container.ditaSourceContent = source;
  const sourceTitle = Array.from(root.childNodes).find(node => node.localName === 'title');
  const title = sourceTitle ? authorHeading(sourceTitle, documentRef, 'h2') : documentRef.createElement('h2');
  container.appendChild(title);
  const body = Array.from(root.childNodes).find(node => BODY_TAGS.has(node.localName));
  const bodyContainer = documentRef.createElement('div');
  bodyContainer.setAttribute('data-dita-body', 'true');
  if (body) {
    for (const node of body.childNodes) {
      const rendered = renderDitaNode(node, documentRef);
      if (rendered) bodyContainer.appendChild(rendered);
    }
  }
  container.appendChild(bodyContainer);
  return container;
}

function renderDitaNode(node, documentRef = document) {
  const rendered = renderAuthorNode(node, documentRef);
  if (rendered && node.nodeType === 1) rendered.ditaSourcePath = xmlNodePath(node);
  return rendered;
}

function renderAuthorNode(node, documentRef = document) {
  if (node.nodeType === 3) {
    const text = node.data.replace(/\s+/g, ' ');
    if (text.trim()) return documentRef.createTextNode(text);
    return null;
  }
  if (node.nodeType !== 1) return null;
  const tag = node.localName;
  if (tag === 'title') return null;
  if (tag === 'shortdesc') {
    const element = documentRef.createElement('p');
    element.setAttribute('data-dita-source', 'shortdesc');
    for (const attribute of Array.from(node.attributes || [])) element.setAttribute(attribute.name, attribute.value);
    for (const child of node.childNodes) {
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) element.appendChild(rendered);
    }
    return element;
  }
  if (tag === 'note') {
    const element = documentRef.createElement('div');
    element.className = `note ${node.getAttribute('type') || ''}`.trim();
    element.setAttribute('data-dita-source', 'note');
    for (const attribute of Array.from(node.attributes || [])) {
      if (attribute.name !== 'type') element.setAttribute(attribute.name, attribute.value);
    }
    for (const child of node.childNodes) {
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) element.appendChild(rendered);
    }
    return element;
  }
  if (tag === 'codeblock') {
    const element = documentRef.createElement('pre');
    element.setAttribute('data-dita-source', 'codeblock');
    for (const attribute of Array.from(node.attributes || [])) element.setAttribute(attribute.name, attribute.value);
    element.textContent = node.textContent;
    return element;
  }
  if (tag === 'image') {
    const element = documentRef.createElement('img');
    const href = node.getAttribute('href') || '';
    element.src = '/api/asset?path=' + encodeURIComponent(resolveAssetPath(href));
    element.alt = node.getAttribute('alt') || '';
    element.setAttribute('data-dita-source', 'image');
    element.setAttribute('data-dita-href', href);
    for (const attribute of Array.from(node.attributes || [])) {
      if (!['href', 'alt'].includes(attribute.name)) element.setAttribute(attribute.name, attribute.value);
    }
    return element;
  }
  if (tag === 'table') {
    const wrapper = documentRef.createElement('div');
    wrapper.setAttribute('data-dita-source', 'table');
    // Keep the original table structure available while editing cells. This
    // lets the serializer retain colspecs, tgroup attributes, captions, and
    // other DITA table metadata that has no direct HTML equivalent.
    wrapper.setAttribute('data-dita-original', serializeXmlNode(node));
    for (const attribute of Array.from(node.attributes || [])) wrapper.setAttribute(attribute.name, attribute.value);
    const sourceTitle = Array.from(node.childNodes).find(child => child.localName === 'title');
    if (sourceTitle) wrapper.appendChild(authorHeading(sourceTitle, documentRef));
    const rows = [];
    const collectRows = (current, section = 'tbody') => {
      for (const child of Array.from(current.childNodes || [])) {
        if (child.nodeType !== 1) continue;
        const nextSection = child.localName === 'thead' || child.localName === 'tbody' ? child.localName : section;
        if (child.localName === 'row') rows.push({ node: child, section: nextSection });
        else collectRows(child, nextSection);
      }
    };
    collectRows(node);
    const htmlTable = documentRef.createElement('table');
    const htmlSections = new Map();
    for (const item of rows) {
      const row = item.node;
      const tr = documentRef.createElement('tr');
      tr.ditaSourcePath = xmlNodePath(row);
      tr.setAttribute('data-dita-row-attrs', JSON.stringify(Object.fromEntries(Array.from(row.attributes || []).map(attribute => [attribute.name, attribute.value]))));
      tr.setAttribute('data-dita-section', item.section);
      for (const entry of row.children) {
        const cell = documentRef.createElement(item.section === 'thead' ? 'th' : 'td');
        cell.ditaSourcePath = xmlNodePath(entry);
        cell.setAttribute('data-dita-source', 'entry');
        cell.setAttribute('data-dita-entry-attrs', JSON.stringify(Object.fromEntries(Array.from(entry.attributes || []).map(attribute => [attribute.name, attribute.value]))));
        for (const child of entry.childNodes || []) {
          const rendered = child.nodeType === 3
            ? documentRef.createTextNode(child.data)
            : renderDitaNode(child, documentRef);
          if (rendered) cell.appendChild(rendered);
        }
        tr.appendChild(cell);
      }
      let section = htmlSections.get(item.section);
      if (!section) {
        section = documentRef.createElement(item.section === 'thead' ? 'thead' : 'tbody');
        htmlSections.set(item.section, section);
        htmlTable.appendChild(section);
      }
      section.appendChild(tr);
    }
    wrapper.appendChild(htmlTable);
    return wrapper;
  }
  if (['ul', 'ol', 'sl'].includes(tag)) {
    const element = documentRef.createElement(tag === 'sl' ? 'ul' : tag);
    element.setAttribute('data-dita-source', tag);
    for (const attr of Array.from(node.attributes || [])) element.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (['li', 'sli'].includes(child.localName)) {
        const item = documentRef.createElement('li');
        item.ditaSourcePath = xmlNodePath(child);
        item.setAttribute('data-dita-source', child.localName === 'sli' ? 'sli' : 'li');
        for (const attr of Array.from(child.attributes || [])) item.setAttribute(attr.name, attr.value);
        for (const nested of child.childNodes) {
          const rendered = renderDitaNode(nested, documentRef);
          if (rendered) item.appendChild(rendered);
        }
        element.appendChild(item);
      } else {
        const rendered = renderDitaNode(child, documentRef);
        if (rendered) element.appendChild(rendered);
      }
    }
    return element;
  }
  if (['p', 'example', 'fig', 'section'].includes(tag)) {
    const element = documentRef.createElement(tag === 'p' ? 'p' : 'div');
    for (const attribute of Array.from(node.attributes || [])) element.setAttribute(attribute.name, attribute.value);
    element.setAttribute('data-dita-source', tag);
    for (const child of node.childNodes) {
      if (child.localName === 'title') {
        // Author presents container titles as real headings. Keeping the
        // heading in the visual tree also lets the source serializer map it
        // back to the original DITA <title> without forcing source editing.
        if (tag !== 'p') {
          element.appendChild(authorHeading(child, documentRef));
        }
        continue;
      }
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) element.appendChild(rendered);
    }
    return element;
  }
  if (tag === 'xref' || ['ph', 'b', 'i', 'u', 'codeph', 'keyword', 'term', 'cite'].includes(tag)) {
    const element = documentRef.createElement(tag === 'xref' ? 'a' : 'span');
    element.setAttribute('data-dita-source', tag);
    for (const attribute of Array.from(node.attributes || [])) element.setAttribute(attribute.name, attribute.value);
    for (const child of node.childNodes) {
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) element.appendChild(rendered);
    }
    return element;
  }
  // Preserve DITA elements that do not have a dedicated Author renderer yet.
  // They remain editable as a neutral block/inline surface and carry their
  // original element name in data-dita-source, so visual round-tripping does
  // not silently delete task steps, definition lists, foreign content, etc.
  if (tag === 'dl') {
    const el = documentRef.createElement('dl');
    el.setAttribute('data-dita-source', 'dl');
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.localName === 'dlentry') {
        for (const entry of child.childNodes) {
          if (entry.nodeType !== 1) continue;
          if (entry.localName === 'dt') {
            const dt = documentRef.createElement('dt');
            dt.ditaSourcePath = xmlNodePath(entry);
            for (const attr of Array.from(entry.attributes || [])) dt.setAttribute(attr.name, attr.value);
            dt.textContent = entry.textContent;
            el.appendChild(dt);
          } else if (entry.localName === 'dd') {
            const dd = documentRef.createElement('dd');
            dd.ditaSourcePath = xmlNodePath(entry);
            for (const attr of Array.from(entry.attributes || [])) dd.setAttribute(attr.name, attr.value);
            dd.setAttribute('data-dita-source', 'dd');
            for (const dc of entry.childNodes) {
              const r = renderDitaNode(dc, documentRef);
              if (r) dd.appendChild(r);
            }
            el.appendChild(dd);
          }
        }
      }
    }
    return el;
  }
  if (tag === 'fn') {
    _ctx.fnCounter++;
    const sup = documentRef.createElement('sup');
    sup.className = 'fn-ref';
    sup.setAttribute('data-dita-source', 'fn');
    sup.setAttribute('data-dita-original', serializeXmlNode(node));
    sup.setAttribute('contenteditable', 'false');
    sup.setAttribute('role', 'button');
    sup.setAttribute('tabindex', '0');
    sup.setAttribute('aria-label', '注脚 ' + _ctx.fnCounter + '，双击或按 Enter 编辑');
    sup.textContent = '[' + _ctx.fnCounter + ']';
    sup.title = node.textContent.trim() + ' · 双击编辑';
    sup.setAttribute('data-fn-text', node.textContent.trim());
    return sup;
  }
  if (tag === 'filepath') {
    const el = documentRef.createElement('code');
    el.className = 'filepath';
    el.textContent = node.textContent;
    return el;
  }
  if (tag === 'ins') {
    const el = documentRef.createElement('span');
    el.className = 'oxy-insert';
    if (node.hasAttribute('data-oxy-index')) el.dataset.oxyIndex = node.getAttribute('data-oxy-index');
    if (node.hasAttribute('data-author')) el.title = '插入 — ' + node.getAttribute('data-author');
    for (const child of node.childNodes) {
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) el.appendChild(rendered);
    }
    return el;
  }
  if (tag === 'del') {
    const el = documentRef.createElement('span');
    el.className = 'oxy-delete';
    el.textContent = node.textContent;
    if (node.hasAttribute('data-oxy-index')) el.dataset.oxyIndex = node.getAttribute('data-oxy-index');
    if (node.hasAttribute('data-author')) el.title = '删除 — ' + node.getAttribute('data-author');
    return el;
  }
  if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) {
    const el = documentRef.createElement('span');
    el.className = 'oxy-comment';
    const comment = node.getAttribute('data-comment');
    const author = node.getAttribute('data-author');
    if (node.hasAttribute('data-oxy-index')) el.dataset.oxyIndex = node.getAttribute('data-oxy-index');
    if (comment) el.title = (author ? author + '：' : '') + comment;
    for (const child of node.childNodes) {
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) el.appendChild(rendered);
    }
    return el;
  }
  const inline = new Set(['cmd', 'info', 'term', 'dt', 'dd', 'keyword', 'q', 'sub', 'sup', 'u', 'varname', 'parmname', 'tm', 'menucascade', 'uicontrol', 'state', 'boolean']);
  const element = documentRef.createElement(inline.has(tag) ? 'span' : 'div');
  element.setAttribute('data-dita-source', tag);
  for (const attribute of Array.from(node.attributes || [])) element.setAttribute(attribute.name, attribute.value);
  for (const child of node.childNodes) {
    if (child.localName === 'title') {
      element.appendChild(authorHeading(child, documentRef));
      continue;
    }
    const rendered = renderDitaNode(child, documentRef);
    if (rendered) element.appendChild(rendered);
  }
  return element;
}


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

const deliveryCore = (typeof module !== 'undefined' ? require('./delivery-core') : window.DitaDeliveryCore)
  .createDeliveryCore({ parseXml, normalizeOxyPIs, resolveAssetPath });
const { collectPreviewPaths, exportMapToHtml, exportMapToMarkdown, ditaToMarkdown, renderMarkdownToHtml, highlightMarkdown } = deliveryCore;

const { lineDiff, inlineDiff, groupDiffRows, applyDiffGroups } = typeof module !== 'undefined' ? require('./diff-core') : window.DitaDiffCore;

function createVisualApi(state, dom) {
  return {
    updateVisualFromXml(source, normalizeOxy) {
      const topicPath = state.activePath || '';
      updateVisualFromXml(state, dom, source, dom.visualEditor.ownerDocument, normalizeOxy, topicPath);
    },
    visualToXml(source) {
      const file = state.filesMap.get(state.activePath);
      const current = source ?? file.current;
      const next = updateCurrentFromVisual(state, dom, current);
      return next;
    }
  };
}

const _exports = {
  BODY_TAGS, INLINE_TAGS, SKIP_TAGS, VISUAL_TO_DITA,
  stripDocType, parseXml, serializeXmlNode, cloneDitaNode,
  visualElementToDita, updateDitaBody, updateCurrentFromVisual,
  updateVisualFromXml, createAuthorTopic, renderDitaNode,
  collectPreviewPaths,
  createVisualApi, lineDiff, inlineDiff, groupDiffRows,
  applyDiffGroups, normalizeOxyPIs, collectOxyTrackedChanges,
  exportMapToHtml, exportMapToMarkdown, ditaToMarkdown,
  renderMarkdownToHtml, highlightMarkdown
};
if (typeof module !== 'undefined') module.exports = _exports;
if (typeof window !== 'undefined') window.DitaVisualCore = _exports;

