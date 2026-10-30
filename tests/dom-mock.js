class MockNode {
  constructor(type, name) {
    this.nodeType = type; this.nodeName = name; this.localName = name;
    this.childNodes = []; this.parentNode = null; this.attributes = []; this.data = ''; this.listeners = new Map();
    if (type === 1) { this.tagName = name.toUpperCase(); this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.nodeType === 3 || this.nodeType === 7 || this.nodeType === 8 ? this.data : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); if (value !== '') this.appendChild(this.ownerDocument.createTextNode(value)); }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); return this; }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; node.ownerDocument = this.ownerDocument || this; this.childNodes.push(node); return node; }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); node.parentNode = null; return node; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { [...this.childNodes].forEach(child => this.removeChild(child)); nodes.forEach(node => this.appendChild(node)); }
  replaceWith(...nodes) { if (!this.parentNode) return; const parent = this.parentNode; const index = parent.childNodes.indexOf(this); parent.childNodes.splice(index, 1, ...nodes); nodes.forEach(node => { node.parentNode = parent; }); this.parentNode = null; }
  insertBefore(node, reference) { const index = this.childNodes.indexOf(reference); if (index < 0) this.appendChild(node); else { node.parentNode = this; this.childNodes.splice(index, 0, node); } return node; }
  getAttribute(name) { const attribute = this.attributes.find(item => item.name === name); return attribute ? attribute.value : null; }
  setAttribute(name, value) { const attribute = this.attributes.find(item => item.name === name); if (attribute) attribute.value = String(value); else this.attributes.push({ name, value: String(value) }); }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  cloneNode(deep = false) { if (this.nodeType === 3) return this.ownerDocument.createTextNode(this.data); if (this.nodeType !== 1) return this; const clone = this.ownerDocument.createElement(this.localName); clone.attributes = this.attributes.map(attribute => ({ ...attribute })); if (deep) for (const child of this.childNodes) clone.appendChild(child.cloneNode(true)); return clone; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { const result = []; const walk = node => { for (const child of node.childNodes || []) { if (child.nodeType === 1) result.push(child); walk(child); } }; walk(this); return result.filter(node => node.localName === selector); }
}

class MockDocument extends MockNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.documentElement = null; }
  createElement(name) { const node = new MockNode(1, name); node.ownerDocument = this; return node; }
  createDocumentFragment() { const node = new MockNode(11, '#document-fragment'); node.ownerDocument = this; return node; }
  createTextNode(data) { const node = new MockNode(3, '#text'); node.data = String(data); node.ownerDocument = this; return node; }
  createComment(data) { const node = new MockNode(8, '#comment'); node.data = String(data); node.ownerDocument = this; return node; }
  createProcessingInstruction(target, data) { const node = new MockNode(7, target); node.target = target; node.data = String(data); node.ownerDocument = this; return node; }
}

function decodeXmlText(value) { return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

function parseMockXml(source) {
  const doc = new MockDocument(); let cursor = 0; const stack = [doc];
  const append = node => { const parent = stack[stack.length - 1]; parent.appendChild(node); if (!doc.documentElement && node.nodeType === 1) doc.documentElement = node; };
  while (cursor < source.length) {
    if (!source.startsWith('<', cursor)) { const next = source.indexOf('<', cursor); const end = next < 0 ? source.length : next; const text = source.slice(cursor, end); append(doc.createTextNode(decodeXmlText(text))); cursor = end; continue; }
    if (source.startsWith('<?', cursor)) { const end = source.indexOf('?>', cursor + 2); const content = source.slice(cursor + 2, end); const space = content.indexOf(' '); if (content.trim() !== 'xml') append(doc.createProcessingInstruction(content.slice(0, space), content.slice(space + 1).trim())); cursor = end + 2; continue; }
    if (source.startsWith('<!--', cursor)) { const end = source.indexOf('-->', cursor + 4); append(doc.createComment(source.slice(cursor + 4, end))); cursor = end + 3; continue; }
    if (source.startsWith('<!', cursor)) { let end = source.indexOf('>', cursor); if (source.slice(cursor, end + 1).includes('[')) end = source.indexOf(']>', end) + 1; cursor = end + 1; continue; }
    if (source.startsWith('</', cursor)) { const end = source.indexOf('>', cursor); const name = source.slice(cursor + 2, end).trim(); if (stack[stack.length - 1].localName !== name) throw new Error(`Mismatched closing tag: ${name}`); stack.pop(); cursor = end + 1; continue; }
    const end = source.indexOf('>', cursor); if (end < 0) throw new Error('Unclosed tag');
    const selfClosing = source[end - 1] === '/'; const tag = source.slice(cursor + 1, selfClosing ? end - 1 : end).trim(); const match = /^([^\s/]+)([\s\S]*)$/.exec(tag); if (!match) throw new Error('Invalid tag');
    const element = doc.createElement(match[1]); const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let attribute;
    while ((attribute = attributePattern.exec(match[2] || ''))) element.setAttribute(attribute[1], decodeXmlText(attribute[2] ?? attribute[3]));
    append(element); if (!selfClosing) stack.push(element); cursor = end + 1;
  }
  if (stack.length !== 1) throw new Error('Unclosed XML element'); return doc;
}

function buildMockDom() { const document = new MockDocument(); global.DOMParser = class { parseFromString(source) { return parseMockXml(source); } }; return { document, MockDocument }; }
function stripDocType(text) {
  return text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/i, '');
}

function parseXml(text) {
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
  const attributes = (node.attributes || []).map(attribute => ` ${attribute.name}="${String(attribute.value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('');
  if (!node.childNodes.length) return `<${node.localName}${attributes}/>`;
  return `<${node.localName}${attributes}>${node.childNodes.map(serializeXmlNode).join('')}</${node.localName}>`;
}

function cloneDitaNode(node, documentRef) {
  if (node.nodeType === 3) { const text = documentRef.createTextNode(node.data); text.localName = '#text'; return text; }
  if (node.nodeType !== 1) return null;
  const clone = documentRef.createElement(node.localName);
  for (const attribute of node.attributes || []) clone.setAttribute(attribute.name, attribute.value);
  for (const child of node.childNodes) {
    const childClone = cloneDitaNode(child, documentRef);
    if (childClone) clone.appendChild(childClone);
  }
  return clone;
}

function visualElementToDita(node, documentRef, preserveAttributes = false) {
  if (node.nodeType !== 1) return null;
  const sourceTag = node.localName.toLowerCase();
  const ditaTag = VISUAL_TO_DITA.get(sourceTag) || sourceTag;
  const element = documentRef.createElement(ditaTag);
  if (preserveAttributes) {
    for (const attribute of node.attributes || []) {
      const name = attribute.name.toLowerCase();
      if (!['class', 'style', 'contenteditable', 'data-dita-source'].includes(name)) element.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      if (child.data.trim()) element.appendChild(documentRef.createTextNode(child.data));
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
    : root.childNodes.find(node => BODY_TAGS.has(node.localName));
  if (!sourceBody) throw new Error(`No DITA body found in <${root.localName}>`);

  const bodyClone = cloneDitaNode(sourceBody, document);
  const sourceTitle = root.childNodes.find(node => node.localName === 'title');
  const visualTitle = visualContainer.childNodes.find(node => node.localName === 'h2');
  const bodyContent = visualContainer.childNodes.find(node => node.localName === 'div' && node.hasAttribute('data-dita-body'));
  if (!visualTitle || !bodyContent) throw new Error('Visual editor is missing its editable title or body');

  const titleElement = visualElementToDita(visualTitle, document, true);
  if (sourceTitle) sourceTitle.replaceWith(titleElement);
  else root.insertBefore(titleElement, sourceBody);

  const newContent = [];
  for (const node of bodyContent.childNodes) {
    const converted = visualElementToDita(node, document);
    if (converted) newContent.push(converted);
  }
  bodyClone.replaceChildren(...newContent);
  if (sourceBody !== root) sourceBody.replaceWith(bodyClone);
  else root.replaceChildren(...root.childNodes.filter(node => node !== sourceBody), bodyClone);
  return root;
}

function updateCurrentFromVisual(state, dom, source) {
  const doc = parseXml(source);
  const root = doc.documentElement.cloneNode(true);
  updateDitaBody(root, dom.visualEditor, doc);
  const declaration = source.match(/^\s*<\?xml[^?]*\?>/i)?.[0] || '<?xml version="1.0" encoding="UTF-8"?>';
  const doctype = source.match(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/i)?.[0] || '';
  return `${declaration}\n${doctype ? `${doctype}\n` : ''}${serializeXmlNode(root)}\n`;
}

function updateVisualFromXml(state, dom, source, documentRef = document) {
  const doc = parseXml(source);
  const root = doc.documentElement;
  const container = documentRef.createElement('article');
  const title = documentRef.createElement('h2');
  const sourceTitle = root.childNodes.find(node => node.localName === 'title');
  title.textContent = sourceTitle ? sourceTitle.textContent : '';
  container.appendChild(title);
  const body = root.childNodes.find(node => BODY_TAGS.has(node.localName));
  const bodyContainer = documentRef.createElement('div');
  bodyContainer.setAttribute('data-dita-body', 'true');
  if (body) {
    for (const node of body.childNodes) {
      const rendered = renderDitaNode(node, documentRef);
      if (rendered) bodyContainer.appendChild(rendered);
    }
  }
  container.appendChild(bodyContainer);
  dom.visualEditor.replaceChildren(...container.childNodes);
}

function renderDitaNode(node, documentRef = document) {
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
    element.setAttribute('data-dita-shortdesc', 'true');
    element.textContent = node.textContent;
    return element;
  }
  if (tag === 'note') {
    const element = documentRef.createElement('div');
    element.className = `note ${node.getAttribute('type') || ''}`.trim();
    element.textContent = node.textContent;
    return element;
  }
  if (tag === 'codeblock') {
    const element = documentRef.createElement('pre');
    element.textContent = node.textContent;
    return element;
  }
  if (tag === 'image') {
    const element = documentRef.createElement('img');
    const href = node.getAttribute('href') || '';
    element.src = `/api/asset?path=${encodeURIComponent(decodeURIComponent(href.split('?')[0].split('#')[0]))}`;
    element.alt = node.getAttribute('alt') || '';
    return element;
  }
  if (tag === 'table') {
    const wrapper = documentRef.createElement('div');
    const rows = node.querySelectorAll('thead > row, tbody > row');
    const htmlTable = documentRef.createElement('table');
    for (const row of rows) {
      const tr = documentRef.createElement('tr');
      for (const entry of row.children) {
        const cell = documentRef.createElement(row.parentElement.localName === 'thead' ? 'th' : 'td');
        cell.textContent = entry.textContent;
        tr.appendChild(cell);
      }
      htmlTable.appendChild(tr);
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
        item.textContent = child.textContent;
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
    element.setAttribute('data-dita-source', tag);
    for (const child of node.childNodes) {
      if (child.localName === 'title') continue;
      const rendered = renderDitaNode(child, documentRef);
      if (rendered) element.appendChild(rendered);
    }
    return element;
  }
  return null;
}

module.exports = { buildMockDom, parseMockXml, MockNode, MockDocument };



