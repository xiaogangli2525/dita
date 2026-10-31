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

module.exports = { buildMockDom, parseMockXml, MockNode, MockDocument };




