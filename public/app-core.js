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
      let title = Array.from(table.childNodes).find(child => child.localName === 'title');
      if (!title) {
        title = documentRef.createElement('title');
        table.insertBefore(title, table.firstChild);
      }
      title.textContent = visualTitle.textContent || '';
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
}


function resetFnCounter() { _ctx.fnCounter = 0; }
function createAuthorTopic(source, documentRef = document, normalizeOxy = false, topicPath = '') {
  _ctx.topicPath = topicPath;
  resetFnCounter();
  const doc = parseXml(source);
  if (normalizeOxy) normalizeOxyPIs(doc, true);
  const root = doc.documentElement;
  const container = documentRef.createElement('article');
  const title = documentRef.createElement('h2');
  const sourceTitle = Array.from(root.childNodes).find(node => node.localName === 'title');
  title.textContent = sourceTitle ? sourceTitle.textContent : '';
  if (sourceTitle) {
    title.ditaSourcePath = xmlNodePath(sourceTitle);
    for (const attr of Array.from(sourceTitle.attributes || [])) title.setAttribute(attr.name, attr.value);
  }
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
    if (sourceTitle) {
      const heading = documentRef.createElement('h3');
      heading.textContent = sourceTitle.textContent || '';
      wrapper.appendChild(heading);
    }
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
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (['li', 'sli'].includes(child.localName)) {
        const item = documentRef.createElement('li');
        item.setAttribute('data-dita-source', child.localName === 'sli' ? 'sli' : 'li');
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
          const heading = documentRef.createElement('h3');
          heading.textContent = child.textContent || '';
          for (const attribute of Array.from(child.attributes || [])) heading.setAttribute(attribute.name, attribute.value);
          element.appendChild(heading);
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
            dt.textContent = entry.textContent;
            el.appendChild(dt);
          } else if (entry.localName === 'dd') {
            const dd = documentRef.createElement('dd');
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
    sup.textContent = '[' + _ctx.fnCounter + ']';
    sup.title = node.textContent.trim();
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
      const heading = documentRef.createElement('h3');
      heading.textContent = child.textContent || '';
      for (const attribute of Array.from(child.attributes || [])) heading.setAttribute(attribute.name, attribute.value);
      element.appendChild(heading);
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

const PREVIEW_TOPIC_EXTENSIONS = /\.(dita|xml)$/i;

function collectPreviewPaths(nodes, paths = [], seen = new Set()) {
  for (const node of nodes || []) {
    if (node.type === 'file' && PREVIEW_TOPIC_EXTENSIONS.test(node.path) && !seen.has(node.path)) {
      seen.add(node.path);
      paths.push({ path: node.path, title: node.title || node.path });
    }
    if (node.children) collectPreviewPaths(node.children, paths, seen);
  }
  return paths;
}

function escapeHtmlAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DITA_HTML_MAP = {
  'topic': 'div', 'concept': 'div', 'reference': 'div', 'task': 'div',
  'body': 'div', 'conbody': 'div', 'refbody': 'div', 'taskbody': 'div',
  'section': 'section', 'example': 'section', 'fig': 'figure',
  'p': 'p', 'title': 'h2', 'shortdesc': 'p',
  'note': 'div', 'codeblock': 'pre', 'codeph': 'code', 'filepath': 'code',
  'varname': 'code', 'parmname': 'code', 'msgph': 'code',
  'sl': 'ul', 'sli': 'li', 'ul': 'ul', 'ol': 'ol', 'li': 'li',
  'dl': 'dl', 'dlentry': 'div', 'dt': 'dt', 'dd': 'dd',
  'table': 'table', 'tgroup': 'div', 'thead': 'thead', 'tbody': 'tbody',
  'row': 'tr', 'entry': 'td',
  'xref': 'a', 'cite': 'cite', 'keyword': 'span', 'term': 'span',
  'ph': 'span', 'b': 'strong', 'i': 'em', 'u': 'u', 'sup': 'sup', 'sub': 'sub',
  'q': 'q', 'boolean': 'span', 'state': 'span',
  'image': 'img', 'object': 'div', 'pre': 'pre', 'lines': 'pre',
  'menucascade': 'span', 'uicontrol': 'span', 'wintitle': 'span',
  'fn': 'sup', 'abbreviated-form': 'span'
};

const DITA_INLINE_TAGS = new Set([
  'codeph', 'filepath', 'varname', 'parmname', 'msgph', 'keyword', 'term',
  'xref', 'cite', 'ph', 'b', 'i', 'u', 'sup', 'sub', 'q', 'boolean', 'state',
  'menucascade', 'uicontrol', 'wintitle', 'fn', 'abbreviated-form'
]);

function ditaToHtml(node, ctx) {
  ctx = ctx || _ctx;
  if (node.nodeType === 3) return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (node.nodeType === 7) return '';
  if (node.nodeType === 8) return '<!--' + node.data + '-->';
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  if (tag === 'oxy_options') return '';
  if (tag === 'ins' && (node.getAttribute('class') || '').includes('oxy-insert')) {
    return '<ins class="oxy-insert">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</ins>';
  }
  if (tag === 'del' && (node.getAttribute('class') || '').includes('oxy-delete')) {
    return '<del class="oxy-delete">' + escapeHtmlAttr(node.textContent) + '</del>';
  }
  if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) {
    const comment = node.getAttribute('data-comment') || '';
    const author = node.getAttribute('data-author') || '';
    const title = author ? author + ': ' + comment : comment;
    return '<span class="oxy-comment" title="' + escapeHtmlAttr(title) + '">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</span>';
  }
  if (tag === 'fn') {
    ctx.htmlFootnotes = ctx.htmlFootnotes || [];
    const n = ctx.htmlFootnotes.length + 1;
    ctx.htmlFootnotes.push('');
    const models = node.getAttribute('product');
    const label = models ? '<small>适用型号：' + escapeHtmlAttr(models) + '</small> ' : '';
    ctx.htmlFootnotes[n - 1] = label + Array.from(node.childNodes).map(child => ditaToHtml(child, ctx)).join('');
    return '<sup class="fn-ref" id="fnref-' + n + '"><a href="#fn-' + n + '">[' + n + ']</a></sup>';
  }
  if (tag === 'image') {
    const href = node.getAttribute('href') || '';
    const alt = node.getAttribute('alt') || '';
    const resolved = resolveAssetPath(href, ctx);
    const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : /^(https?:|data:)/i.test(resolved) ? resolved : '/api/asset?path=' + encodeURIComponent(resolved);
    return '<img src="' + escapeHtmlAttr(src) + '" alt="' + escapeHtmlAttr(alt) + '" style="max-width:100%;"/>';
  }
  if (tag === 'xref') {
    const href = node.getAttribute('href') || '';
    return '<a href="' + escapeHtmlAttr(href) + '">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</a>';
  }
  const htmlTag = DITA_HTML_MAP[tag] || 'div';
  const attrs = [];
  if (tag === 'codeblock') {
    const lang = (node.getAttribute('outputclass') || '').replace('language-', '');
    if (lang) attrs.push('data-lang="' + escapeHtmlAttr(lang) + '"');
  }
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  const children = Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('');
  if (!DITA_INLINE_TAGS.has(tag) && !children.trim()) return '';
  return '<' + htmlTag + attrStr + '>' + children + '</' + htmlTag + '>';
}

function serializeOxyNode(node, ctx) {
  return ditaToHtml(node, ctx);
}

async function exportMapToHtml({ map, files, title, loadImageBytes }) {
  const ctx = { topicPath: '', imageDataCache: new Map(), fnCounter: 0, mdFnCounter: 0, mdFootnotes: [] };
  const entries = collectPreviewPaths(map.children || []);
  const sections = [];
  const failures = [];
  ctx.imageDataCache = new Map();
  if (loadImageBytes) {
    const imagePaths = new Set();
    for (const entry of entries) {
      try {
        const cached = files.get(entry.path);
        if (!cached) throw new Error('not loaded');
        const preDoc = parseXml(cached.current);
        ctx.topicPath = entry.path;
        for (const img of preDoc.querySelectorAll('image')) {
          const r2 = resolveAssetPath(img.getAttribute('href') || '', ctx);
          if (r2 && !/^(https?:|data:|\x2f)/i.test(r2)) imagePaths.add(r2);
        }
      } catch (e) { console.warn('image pre-fetch parse error:', e.message); }
    }
    await Promise.all(Array.from(imagePaths).map(async (p) => {
      try {
        const dataUri = await loadImageBytes(p);
        if (dataUri) ctx.imageDataCache.set(p, dataUri);
      } catch (e) { console.warn('image fetch failed:', p, e.message); }
    }));
  }
  for (const entry of entries) {
    try {
      const cached = files.get(entry.path);
      if (!cached) throw new Error('not loaded');
      ctx.topicPath = entry.path;
      const doc = parseXml(cached.current);
      normalizeOxyPIs(doc);
      const topic = doc.documentElement;
      const topicTitle = Array.from(topic?.childNodes || []).find(n => n.localName === 'title');
      let inner = '';
      for (const child of topic?.childNodes || []) {
        if (child === topicTitle) continue;
        inner += serializeOxyNode(child, ctx);
      }
      let fnNum = 0;
      inner = inner.replace(/\[fn\]/g, () => "[" + (++fnNum) + "]");
      inner = inner.replace(/<div class="note([\s\S]*?)<\/div>/g, (match) => {
        if (match.includes('note-icon')) return match;
        const typeMatch = match.match(/data-note-type="([^"]*)"/);
        const noteType = typeMatch ? typeMatch[1] : 'note';
        const icons = { note: 'ℹ', tip: '💡', caution: '⚠️', warning: '⛔', restriction: '⛔', attention: '⚠️', important: '❗' };
        const icon = icons[noteType] || '\u2139';
        return '<div class="dita-note dita-note-' + noteType + '"><span class="note-icon">' + icon + '</span><div class="note-body">' + match.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '') + '</div></div>';
      });
      inner = inner.replace(/<codeblock\b/g, '<pre class="code-block"\u200b');
      inner = inner.replace(/<pre class="code-block"\u200b/g, '<pre class="code-block"');
      sections.push({ path: entry.path, title: topicTitle?.textContent?.trim() || entry.title || entry.path, body: inner });
    } catch (error) {
      failures.push(entry.path);
    }
  }
  const css = [
    'body { font-family: Segoe UI, Microsoft YaHei, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #202124; line-height: 1.7; }',
    'h1 { font-size: 28px; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }',
    'h2 { font-size: 22px; color: #1a73e8; margin-top: 32px; border-bottom: 1px solid #e4e7ea; padding-bottom: 6px; }',
    'h3 { font-size: 18px; color: #385667; margin-top: 24px; }',
    'hr { border: none; border-top: 1px solid #e4e7ea; margin: 32px 0; }',
    'pre { background: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }',
    'code { font-family: Consolas, Courier New, monospace; font-size: 0.9em; }',
    'code.filepath { color: #c5221f; background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }',
    'sup.fn-ref { font-size: 0.8em; color: #1a73e8; cursor: pointer; }',
    'ins.oxy-insert { background: #e6f4ea; border-bottom: 2px solid #34a853; text-decoration: none; }',
    'del.oxy-delete { background: #fce8e6; text-decoration: line-through; color: #d93025; }',
    'span.oxy-comment { border-bottom: 2px dotted #4285f4; cursor: help; background: rgba(66,133,244,0.08); }',
    'table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 14px; }',
    'th, td { border: 1px solid #cbd5dd; padding: 7px 9px; vertical-align: top; }',
    'th { background: #eef2f5; }',
    'dl { margin: 10px 0; padding-left: 16px; }',
    'dt { font-weight: 600; color: #385667; }',
    'dd { margin: 2px 0 6px 16px; }',
    '.toc { background: #f8f9fa; padding: 16px 20px; border-radius: 8px; margin-bottom: 28px; }',
    '.toc h2 { font-size: 18px; margin-top: 0; border: none; }',
    '.toc ol { padding-left: 20px; margin: 8px 0; }',
    '.toc a { color: #1a73e8; text-decoration: none; }',
    '.toc a:hover { text-decoration: underline; }',
    '.error { color: #d93025; font-size: 13px; }',
    '.dita-note { display: flex; gap: 10px; padding: 12px 16px; margin: 14px 0; border-radius: 6px; border-left: 4px solid #4285f4; background: #e8f0fe; }',
    '.dita-note .note-icon { font-size: 16px; flex-shrink: 0; margin-top: 2px; }',
    '.dita-note .note-body { flex: 1; }',
    '.dita-note .note-body ul, .dita-note .note-body ol { margin: 4px 0; padding-left: 20px; }',
    '.dita-note.dita-note-tip { border-color: #34a853; background: #e6f4ea; }',
    '.dita-note.dita-note-caution, .dita-note.dita-note-warning { border-color: #d93025; background: #fce8e6; }',
    '.dita-note.dita-note-important { border-color: #f9ab00; background: #fef7e0; }',
    '.code-block { background: #1e1e2e; color: #cdd6f4; padding: 14px 18px; border-radius: 8px; overflow-x: auto; font-family: Consolas, Fira Code, monospace; font-size: 13px; line-height: 1.55; tab-size: 4; }',
    '.code-block code { color: inherit; font-size: inherit; background: none; padding: 0; }',
    '.dita-note .code-block { background: #282838; margin: 8px 0; }',
    'figure { margin: 16px 0; text-align: center; }',
    'figure figcaption, .figtitle { font-size: 13px; color: #5f6368; margin-top: 8px; font-style: italic; }',
    'section { margin: 20px 0; }'

  ].join('\n');
  let toc = '<nav class="toc"><h2>\u76ee\u5f55</h2><ol>';
  sections.forEach((sec, i) => { toc += '<li><a href="#sec-' + i + '">' + escapeHtmlAttr(sec.title) + '</a></li>'; });
  toc += '</ol></nav>';
  let body = '';
  sections.forEach((sec, i) => {
    body += '<h2 id="sec-' + i + '" style="scroll-margin-top: 20px;">' + escapeHtmlAttr(sec.title) + '</h2>\n' + sec.body + '\n';
    if (i < sections.length - 1) body += '<hr>\n';
  });
  if (ctx.htmlFootnotes?.length) body += '<section class="export-footnotes"><h2>注脚</h2><ol>' + ctx.htmlFootnotes.map((text, i) => '<li id="fn-' + (i + 1) + '">' + text + ' <a href="#fnref-' + (i + 1) + '" aria-label="返回正文">↩</a></li>').join('') + '</ol></section>';
  let failuresHtml = '';
  if (failures.length) failuresHtml = '<p class="error">\u4ee5\u4e0b topic \u52a0\u8f7d\u5931\u8d25\uff1a' + failures.map(escapeHtmlAttr).join(', ') + '</p>';
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>' + escapeHtmlAttr(title || map.title || map.path) + '</title>',
    '<style>' + css + '</style></head><body>',
    '<h1>' + escapeHtmlAttr(title || map.title || map.path) + '</h1>',
    toc,
    body,
    failuresHtml,
    '</body></html>'
  ].join('\n');
  return html;
}

function mdEscape(text) {
  return String(text || '').replace(/([\\`*{}\[\]()#+\-.!])/g, '\\$1');
}

function markdownFootnote(node, ctx) {
  ctx.mdFootnotes = ctx.mdFootnotes || [];
  const index = (ctx.mdFnCounter || 0) + 1;
  ctx.mdFnCounter = index;
  const models = node.getAttribute('product');
  const content = (models ? '**适用型号：' + mdEscape(models) + '。** ' : '') + Array.from(node.childNodes).map(child => mdInline(child, ctx)).join('');
  ctx.mdFootnotes.push('[^' + index + ']: ' + content.trim().replace(/\n/g, '\n    '));
  return '[^' + index + ']';
}

function mdInline(node, ctx) {
  ctx = ctx || _ctx;
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  const inner = () => Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('');
  if (tag === 'b') return '**' + inner() + '**';
  if (tag === 'i') return '*' + inner() + '*';
  if (tag === 'u') return inner();
  if (tag === 'sup') return '<sup>' + inner() + '</sup>';
  if (tag === 'sub') return '<sub>' + inner() + '</sub>';
  if (['codeph', 'filepath', 'varname', 'parmname', 'msgph'].includes(tag)) return '`' + node.textContent + '`';
  if (tag === 'xref') { const h = node.getAttribute('href') || ''; return '[' + inner() + '](' + h + ')'; }
  if (tag === 'image') { const resolved = resolveAssetPath(node.getAttribute('href') || '', ctx); const a = node.getAttribute('alt') || ''; const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : resolved; return '![' + a + '](' + src + ')'; }
  if (tag === 'fn') return markdownFootnote(node, ctx);
  if (tag === 'ins' && (node.getAttribute('class') || '').includes('oxy-insert')) return '**' + inner() + '**';
  if (tag === 'del' && (node.getAttribute('class') || '').includes('oxy-delete')) return '~~' + node.textContent + '~~';
  if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) { const c = node.getAttribute('data-comment') || ''; return '<!-- ' + c + ' -->'; }
  if (tag === 'oxy_options') return '';
  return inner();
}



function ditaToMarkdown(node, ctx) {
  ctx = ctx || _ctx;
  if (node.nodeType === 3) { const t = node.data.replace(/\s+/g, ' '); return t; }
  if (node.nodeType === 7 || node.nodeType === 8) return '';
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  if (tag === 'oxy_options') return '';
  const children = () => Array.from(node.childNodes).map(function(n) { return ditaToMarkdown(n, ctx); }).join('');

  if (tag === 'title') return '\n## ' + node.textContent.trim() + '\n\n';
  if (tag === 'p') { const t = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim(); return t ? t + '\n\n' : ''; }
  if (tag === 'shortdesc') { const t = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim(); return t ? '> ' + t + '\n\n' : ''; }

  if (tag === 'ul' || tag === 'sl') return mdList(node, false);
  if (tag === 'ol') return mdList(node, true);

  if (tag === 'codeblock') {
    const lang = (node.getAttribute('outputclass') || '').replace('language-', '');
    return '\n```' + lang + '\n' + node.textContent.replace(/\n$/, '') + '\n```\n\n';
  }
  if (tag === 'pre' || tag === 'lines') return '\n```\n' + node.textContent.replace(/\n$/, '') + '\n```\n\n';

  if (tag === 'note') {
    const type = node.getAttribute('type') || 'note';
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    const body = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim();
    return '> **' + label + ':** ' + body + '\n\n';
  }

  if (tag === 'image') {
    const href = node.getAttribute('href') || '';
    const a = node.getAttribute('alt') || '';
    const resolved = resolveAssetPath(href, ctx);
    const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : resolved;
    return '![' + a + '](' + src + ')\n\n';
  }

  if (tag === 'xref') { const h = node.getAttribute('href') || ''; return '[' + Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('') + '](' + h + ')'; }

  if (tag === 'fig') {
    let r = '\n';
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'title' || c.localName === 'figtitle') r += '*' + c.textContent.trim() + '*\n\n';
      else r += ditaToMarkdown(c, ctx);
    }
    return r;
  }

  if (tag === 'table') return mdTable(node);
  if (tag === 'dl') return mdDl(node);

  if (tag === 'fn') return markdownFootnote(node, ctx);

  if (tag === 'section' || tag === 'example') {
    const tEl = Array.from(node.childNodes).find(n => n.localName === 'title');
    return (tEl ? '\n### ' + tEl.textContent.trim() + '\n\n' : '\n') + children();
  }

  if (['body', 'conbody', 'refbody', 'taskbody', 'topic', 'concept', 'reference', 'task'].includes(tag)) return children();
  if (['figgroup', 'ph', 'keyword', 'term', 'cite', 'q', 'boolean', 'state', 'menucascade', 'uicontrol', 'wintitle', 'abbreviated-form'].includes(tag)) return Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('');
  return children();
}



function mdList(node, ordered, ctx) {
  ctx = ctx || _ctx;
  const items = Array.from(node.childNodes).filter(n => n.localName === 'li' || n.localName === 'sli');
  if (!items.length) return '';
  let r = '';
  items.forEach((li, i) => {
    const prefix = ordered ? (i + 1) + '. ' : '- ';
    const text = Array.from(li.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim();
    r += prefix + text + '\n';
    // nested lists
    for (const c of li.childNodes) {
      if (c.localName === 'ul') r += mdList(c, false).split('\n').filter(Boolean).map(l => '  ' + l).join('\n') + '\n';
      if (c.localName === 'ol') r += mdList(c, true).split('\n').filter(Boolean).map(l => '  ' + l).join('\n') + '\n';
    }
  });
  return r + '\n';
}

function mdTable(node, ctx) {
  ctx = ctx || _ctx;
  const tgroup = Array.from(node.childNodes).find(n => n.localName === 'tgroup') || node;
  const thead = Array.from(tgroup.childNodes).find(n => n.localName === 'thead');
  const tbody = Array.from(tgroup.childNodes).find(n => n.localName === 'tbody') || tgroup;
  const headRows = thead ? Array.from(thead.childNodes).filter(n => n.localName === 'row') : [];
  const bodyRows = Array.from(tbody.childNodes).filter(n => n.localName === 'row');
  const allRows = [...headRows, ...bodyRows];
  if (!allRows.length) return '';
  const matrix = allRows.map(row => Array.from(row.childNodes).filter(n => n.localName === 'entry').map(e => Array.from(e.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim().replace(/\|/g, '\\\|')));
  const cols = Math.max(...matrix.map(r => r.length));
  let r = '\n';
  matrix.forEach((row, i) => {
    while (row.length < cols) row.push('');
    r += '| ' + row.join(' | ') + ' |\n';
    if (i === 0) r += '| ' + Array(cols).fill('---').join(' | ') + ' |\n';
  });
  return r + '\n';
}

function mdDl(node, ctx) {
  ctx = ctx || _ctx;
  const entries = Array.from(node.childNodes).filter(n => n.localName === 'dlentry');
  if (!entries.length) return '';
  let r = '\n';
  for (const entry of entries) {
    const dt = Array.from(entry.childNodes).find(n => n.localName === 'dt');
    const dd = Array.from(entry.childNodes).find(n => n.localName === 'dd');
    if (dt) r += '**' + dt.textContent.trim() + '**\n';
    if (dd) r += ': ' + Array.from(dd.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim() + '\n\n';
  }
  return r;
}

async function exportMapToMarkdown({ map, files, title, loadImageBytes }) {
  const ctx = { topicPath: '', imageDataCache: new Map(), fnCounter: 0, mdFnCounter: 0, mdFootnotes: [] };
  ctx.mdFnCounter = 0;
  ctx.mdFootnotes = [];
  const entries = collectPreviewPaths(map.children || []);
  const sections = [];
  const failures = [];
    if (loadImageBytes) {
    const imagePaths = new Set();
    for (const entry of entries) {
      try {
        const cached = files.get(entry.path);
        if (!cached) throw new Error('not loaded');
        const preDoc = parseXml(cached.current);
        ctx.topicPath = entry.path;
        for (const img of preDoc.querySelectorAll('image')) {
          const r = resolveAssetPath(img.getAttribute('href') || '', ctx);
          if (r && !/^(https?:|data:|\x2f)/i.test(r)) imagePaths.add(r);
        }
      } catch (e) { console.warn('warn:', e.message); }
    }
    await Promise.all(Array.from(imagePaths).map(async (p) => {
      try {
        const dataUri = await loadImageBytes(p);
        if (dataUri) ctx.imageDataCache.set(p, dataUri);
      } catch (e) { console.warn('warn:', e.message); }
    }));
  }
  for (const entry of entries) {
    try {
      const cached = files.get(entry.path);
      if (!cached) throw new Error('not loaded');
      ctx.topicPath = entry.path;
      const doc = parseXml(cached.current);
      normalizeOxyPIs(doc);
      const topic = doc.documentElement;
      const topicTitle = Array.from(topic?.childNodes || []).find(n => n.localName === 'title');
      let body = '';
      for (const child of topic?.childNodes || []) {
        if (child === topicTitle) continue;
        body += ditaToMarkdown(child, ctx);
      }
      sections.push({ path: entry.path, title: topicTitle?.textContent?.trim() || entry.title || entry.path, body });
    } catch (error) {
      failures.push(entry.path);
    }
  }
  let md = '# ' + (title || map.title || map.path) + '\n\n';
  md += '**目录**\n\n';
  sections.forEach((sec, i) => { md += (i + 1) + '. [' + sec.title + '](#' + sec.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-') + ')\n'; });
  md += '\n---\n\n';
  sections.forEach(sec => { md += '## ' + sec.title + '\n\n' + sec.body + '\n'; });
  if (ctx.mdFootnotes.length) {
    md += '\n---\n\n**脚注**\n\n';
    ctx.mdFootnotes.forEach(f => { md += f + '\n'; });
  }
  if (failures.length) md += '\n> 以下 topic 加载失败：' + failures.join(', ') + '\n';
  return md;
}
function highlightMarkdown(md) {
  function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  const lines = esc(md).split(/\n/);
  let out = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.match(/^```/)) {
      inCode = !inCode;
      out.push('<span class="md-code-fence">' + line + '</span>');
      continue;
    }
    if (inCode) { out.push('<span class="md-code-line">' + line + '</span>'); continue; }
    let h = line;
    h = h.replace(/^(#{1,3})\s/, '<span class="md-heading">$1 </span>');
    h = h.replace(/^(&gt;\s?)/, '<span class="md-quote">$1</span>');
    h = h.replace(/^([-*]\s)/, '<span class="md-list">$1</span>');
    h = h.replace(/^(\d+\.\s)/, '<span class="md-list">$1</span>');
    h = h.replace(/^(---\s*)$/, '<span class="md-hr">$1</span>');
    h = h.replace(/^(\|)/, '<span class="md-table">$1</span>');
    h = h.replace(/(`[^`]+`)/g, '<span class="md-inline-code">$1</span>');
    h = h.replace(/(\*\*[^*]+\*\*)/g, '<span class="md-bold">$1</span>');
    h = h.replace(/(~~[^~]+~~)/g, '<span class="md-strike">$1</span>');
    h = h.replace(/(!\[[^\]]*\]\([^)]+\))/g, '<span class="md-image">$1</span>');
    h = h.replace(/(\[[^\]]*\]\([^)]+\))/g, '<span class="md-link">$1</span>');
    h = h.replace(/(\[\^\d+\])/g, '<span class="md-fn">$1</span>');
    out.push(h);
  }
  return out.join('\n');
}
function renderMarkdownToHtml(md) {
  function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function imgSrc(src) {
    if (/^(https?:|data:)/i.test(src)) return src;
    if (src.startsWith('/')) return src;
    return '/api/asset?path=' + encodeURIComponent(src);
  }
  function inline(text) {
    let r = esc(text);
    r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => '<img src="' + imgSrc(src.trim()) + '" alt="' + esc(alt) + '"/>');
    r = r.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (m, txt, href) => '<a href="' + esc(href.trim()) + '">' + esc(txt) + '</a>');
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    r = r.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    r = r.replace(/\[\^(\d+)\]/g, '<sup class="fn-ref">[$1]</sup>');
    return r;
  }
  const lines = md.split(/\n/);
  let html = '';
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      let code = '';
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      i++;
      html += '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(code.replace(/\n$/,'')) + '</code></pre>\n';
      continue;
    }
    if (/^(#{1,3})\s+/.test(line)) {
      const m = line.match(/^(#{1,3})\s+(.*)/);
      const level = m[1].length;
      html += '<h' + level + '>' + inline(m[2]) + '</h' + level + '>\n';
      i++; continue;
    }
    if (/^---\s*$/.test(line)) { html += '<hr/>\n'; i++; continue; }
    if (/^>\s?/.test(line)) {
      let bq = '';
      while (i < lines.length && /^>\s?/.test(lines[i])) { bq += lines[i].replace(/^>\s?/, '') + '\n'; i++; }
      html += '<blockquote>' + inline(bq.trim()) + '</blockquote>\n';
      continue;
    }
    if (/^\|/.test(line)) {
      let tableLines = [];
      while (i < lines.length && /^\|/.test(lines[i])) { tableLines.push(lines[i]); i++; }
      if (tableLines.length >= 2) {
        const header = tableLines[0].split('|').filter(c => c.trim() !== '').map(c => c.trim());
        html += '<table><thead><tr>';
        header.forEach(h => html += '<th>' + inline(h) + '</th>');
        html += '</tr></thead><tbody>';
        for (let r = 2; r < tableLines.length; r++) {
          const cells = tableLines[r].split('|').filter(c => c.trim() !== '').map(c => c.trim());
          html += '<tr>';
          cells.forEach(c => html += '<td>' + inline(c) + '</td>');
          html += '</tr>';
        }
        html += '</tbody></table>\n';
      }
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      let items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      html += '<ul>';
      items.forEach(it => html += '<li>' + inline(it) + '</li>');
      html += '</ul>\n';
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      let items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      html += '<ol>';
      items.forEach(it => html += '<li>' + inline(it) + '</li>');
      html += '</ol>\n';
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    let para = line;
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|>|\||[-*]\s|\d+\.\s|---)/.test(lines[i])) {
      para += ' ' + lines[i]; i++;
    }
    html += '<p>' + inline(para) + '</p>\n';
  }
  return html;
}
function lineDiff(oldText, newText) {
  const oldLines = String(oldText).split(/\r?\n/);
  const newLines = String(newText).split(/\r?\n/);
  // Use an LCS table so inserted/deleted lines stay aligned with the nearest
  // unchanged XML line. The previous lock-step comparison made one insertion
  // mark every following line as changed until the end of the document.
  const product = oldLines.length * newLines.length;
  if (product <= 4000000) {
    const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
        table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
      }
    }
    const rows = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
        rows.push({ type: 'same', oldIndex: oldIndex + 1, newIndex: newIndex + 1, text: oldLines[oldIndex] });
        oldIndex++;
        newIndex++;
      } else if (newIndex < newLines.length && (oldIndex >= oldLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
        rows.push({ type: 'new', newIndex: newIndex + 1, text: newLines[newIndex++] });
      } else {
        rows.push({ type: 'old', oldIndex: oldIndex + 1, text: oldLines[oldIndex++] });
      }
    }
    return rows;
  }

  // Keep large documents responsive without losing the alignment after a
  // small edit.  The old bounded look-ahead implementation could pick a
  // repeated XML line as an anchor and then classify the rest of the topic as
  // changed.  Myers' shortest-edit-path algorithm follows the nearest valid
  // path instead, so a one-line deletion in a large document remains one
  // deleted row.  The edit distance is capped to keep pathological wholesale
  // replacements bounded; those fall back to the conservative block below.
  const maxEditDistance = Math.min(oldLines.length + newLines.length, 2048);
  const offset = maxEditDistance + 1;
  const trace = [];
  let frontier = new Int32Array(offset * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;

  function rowsFromPath(distance) {
    const path = [];
    let oldIndex = oldLines.length;
    let newIndex = newLines.length;
    for (let edit = distance; edit > 0; edit--) {
      const previous = trace[edit];
      const diagonal = oldIndex - newIndex;
      const down = diagonal === -edit || (diagonal !== edit && previous[offset + diagonal - 1] < previous[offset + diagonal + 1]);
      const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
      const previousOld = previous[offset + previousDiagonal];
      const previousNew = previousOld - previousDiagonal;
      while (oldIndex > previousOld && newIndex > previousNew) {
        path.push({
          type: 'same',
          oldIndex,
          newIndex,
          text: oldLines[oldIndex - 1]
        });
        oldIndex--;
        newIndex--;
      }
      if (oldIndex === previousOld) {
        path.push({ type: 'new', newIndex, text: newLines[newIndex - 1] });
        newIndex--;
      } else {
        path.push({ type: 'old', oldIndex, text: oldLines[oldIndex - 1] });
        oldIndex--;
      }
    }
    while (oldIndex > 0 && newIndex > 0) {
      path.push({
        type: 'same',
        oldIndex,
        newIndex,
        text: oldLines[oldIndex - 1]
      });
      oldIndex--;
      newIndex--;
    }
    while (oldIndex > 0) {
      path.push({ type: 'old', oldIndex, text: oldLines[oldIndex - 1] });
      oldIndex--;
    }
    while (newIndex > 0) {
      path.push({ type: 'new', newIndex, text: newLines[newIndex - 1] });
      newIndex--;
    }
    return path.reverse();
  }

  for (let distance = 0; distance <= maxEditDistance; distance++) {
    // Keep the frontier from before this edit layer for path reconstruction.
    trace.push(frontier.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let oldIndex;
      if (diagonal === -distance || (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1])) {
        oldIndex = frontier[offset + diagonal + 1];
      } else {
        oldIndex = frontier[offset + diagonal - 1] + 1;
      }
      let newIndex = oldIndex - diagonal;
      while (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
        oldIndex++;
        newIndex++;
      }
      frontier[offset + diagonal] = oldIndex;
      if (oldIndex >= oldLines.length && newIndex >= newLines.length) return rowsFromPath(distance);
    }
  }

  // A very large replacement is intentionally represented as one changed
  // block. This path is only used once the bounded Myers search is exhausted.
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ type: 'same', oldIndex: ++oldIndex, newIndex: ++newIndex, text: oldLines[oldIndex - 1] });
      continue;
    }
    while (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] !== newLines[newIndex]) {
      rows.push({ type: 'old', oldIndex: oldIndex + 1, text: oldLines[oldIndex++] });
      rows.push({ type: 'new', newIndex: newIndex + 1, text: newLines[newIndex++] });
    }
    while (oldIndex < oldLines.length && newIndex >= newLines.length) rows.push({ type: 'old', oldIndex: oldIndex + 1, text: oldLines[oldIndex++] });
    while (newIndex < newLines.length && oldIndex >= oldLines.length) rows.push({ type: 'new', newIndex: newIndex + 1, text: newLines[newIndex++] });
  }
  return rows;
}

// Produce a compact inline diff for a pair of already-readable text values.
// Review rendering uses this instead of displaying an entire XML row when a
// user changed only a word or two.  The result is intentionally small and
// presentation agnostic so both topic and map review panes can render it:
//   [{ type: 'same'|'old'|'new', text: '...' }, ...]
//
// Character-level LCS gives useful precision for short rows.  Very long rows
// are handled with a common-prefix/suffix fallback to keep the review panel
// responsive and bounded in memory.
function inlineDiff(oldText, newText) {
  const oldValue = String(oldText ?? '');
  const newValue = String(newText ?? '');
  if (oldValue === newValue) return oldValue ? [{ type: 'same', text: oldValue }] : [];

  // Work in Unicode code points rather than UTF-16 code units so an emoji or
  // other astral character cannot be split into two independently coloured
  // fragments in the review pane.
  const oldChars = Array.from(oldValue);
  const newChars = Array.from(newValue);
  const maxCells = 1000000;

  function append(result, type, chars) {
    if (!chars.length) return;
    const text = chars.join('');
    const previous = result[result.length - 1];
    if (previous && previous.type === type) previous.text += text;
    else result.push({ type, text });
  }

  // Peel off the obvious context first. Apart from avoiding unnecessary LCS
  // work, this gives replacements the natural shape `[old], [new]` instead
  // of letting an LCS tie consume all of one side before the other (for
  // example, changing "Old title" to "New title").
  let prefix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]
  ) suffix++;
  const oldMiddle = oldChars.slice(prefix, oldChars.length - suffix);
  const newMiddle = newChars.slice(prefix, newChars.length - suffix);
  const result = [];
  append(result, 'same', oldChars.slice(0, prefix));

  // Keep a bounded algorithm for large rows.  The unchanged prefix and
  // suffix are still useful context while the middle replacement is kept as
  // two precise old/new fragments.
  if (oldMiddle.length * newMiddle.length > maxCells) {
    append(result, 'old', oldMiddle);
    append(result, 'new', newMiddle);
    append(result, 'same', oldChars.slice(oldChars.length - suffix));
    return result;
  }

  const table = Array.from({ length: oldMiddle.length + 1 }, () => new Uint32Array(newMiddle.length + 1));
  for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex][newIndex] = oldMiddle[oldIndex] === newMiddle[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
    if (
      oldIndex < oldMiddle.length &&
      newIndex < newMiddle.length &&
      oldMiddle[oldIndex] === newMiddle[newIndex]
    ) {
      append(result, 'same', [oldMiddle[oldIndex++]]);
    } else if (
      newIndex < newMiddle.length &&
      (oldIndex >= oldMiddle.length || table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])
    ) {
      append(result, 'new', [newMiddle[newIndex++]]);
    } else {
      append(result, 'old', [oldMiddle[oldIndex++]]);
    }
  }
  append(result, 'same', oldChars.slice(oldChars.length - suffix));
  return result;
}

function groupDiffRows(rows, contextSize = 3) {
  const groups = [];
  const pending = [];
  let afterChange = false;

  function emit(rows) {
    if (rows.length) groups.push({ type: 'same', rows });
  }

  for (const row of rows) {
    if (row.type === 'same') {
      pending.push(row);
      continue;
    }

    const rows = pending.splice(0);
    if (!afterChange) emit(contextSize > 0 ? rows.slice(-contextSize) : rows);
    else emit(rows.slice(-contextSize));

    const group = groups[groups.length - 1];
    if (!group || group.type !== 'changed') groups.push({ type: 'changed', rows: [] });
    groups[groups.length - 1].rows.push(row);
    afterChange = true;
  }

  emit(contextSize > 0 ? pending.slice(0, contextSize) : pending);
  return groups;
}

function applyDiffGroups(oldText, newText, decisions, contextSize = 0) {
  // `groupDiffRows` may trim unchanged context between review blocks for a
  // compact display.  That projection must never be used to rebuild the
  // document: omitted context lines would be silently deleted whenever a
  // reviewer accepts or rejects one block in a long file.  The changed-group
  // indexes stay identical when all context is retained, so use an
  // untrimmed grouping for the actual merge.
  const groups = groupDiffRows(lineDiff(oldText, newText), 0);
  const output = [];
  groups.forEach((group, index) => {
    if (group.type === 'same') {
      output.push(...group.rows.map(row => row.text));
      return;
    }
    const decision = decisions instanceof Map ? decisions.get(index) : undefined;
    const keepNew = decision === 'accept';
    const oldRows = group.rows.filter(row => row.type === 'old');
    const newRows = group.rows.filter(row => row.type === 'new');
    output.push(...(keepNew ? newRows : oldRows).map(row => row.text));
  });
  // Preserve the working document's line-ending convention. The baseline
  // often comes from `git show` (LF) while the open file may be CRLF; using
  // the baseline here would rewrite the entire document after one decision.
  const joiner = /\r\n/.test(String(newText))
    ? '\r\n'
    : /\r\n/.test(String(oldText)) ? '\r\n' : '\n';
  return output.join(joiner);
}
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

