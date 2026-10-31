'use strict';
const { inspectSource } = require('../public/xml-source');
const sax = require('../public/vendor/sax');

function decodeEntities(value) {
  return String(value).replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|lt|gt|quot|apos|amp);/g, (m, dec, hex) => {
    try {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
    } catch (e) {
      return m;
    }
    if (m === '&lt;') return '<';
    if (m === '&gt;') return '>';
    if (m === '&quot;') return String.fromCharCode(34);
    if (m === '&apos;') return String.fromCharCode(39);
    if (m === '&amp;') return '&';
    return m;
  });
}

// Syntax is validated by the same boundary as the browser. SAX supplies the
// domain tree, without a second permissive handwritten XML parser.
function parseXml(text) {
  const range = inspectSource(text);
  const stack = [];
  let root = null, declaration = null, doctype = null;
  const parser = sax.parser(true, { xmlns: true });
  const append = node => { if (stack.length) stack.at(-1).children.push(node); };
  parser.onopentag = tag => {
    const node = { type: 'element', name: tag.name,
      attrs: Object.fromEntries(Object.values(tag.attributes).map(attr => [attr.name, attr.value])), children: [] };
    if (!root) root = node;
    append(node); stack.push(node);
  };
  parser.onclosetag = () => stack.pop();
  parser.ontext = value => append({ type: 'text', value });
  parser.oncdata = value => append({ type: 'text', value, cdata: true });
  parser.oncomment = value => append({ type: 'comment', value });
  parser.onprocessinginstruction = pi => {
    if (pi.name === 'xml') declaration = text.match(/^\uFEFF?(<\?xml[\s\S]*?\?>)/)?.[1]
      || text.match(/^(<\?xml[\s\S]*?\?>)/)?.[1] || null;
    else append({ type: 'pi', value: pi.name + (pi.body ? ' ' + pi.body : '') });
  };
  parser.ondoctype = value => { doctype = '<!DOCTYPE' + value + '>'; };
  parser.write(text).close();
  return { declaration, doctype, root, prefix: text.slice(0, range.start),
    suffix: text.slice(range.close ? range.close.end : range.end) };
}

function encodeXmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeXmlAttribute(value) {
  return encodeXmlText(value).replace(/"/g, "&quot;");
}

function serializeXmlNode(node, level = 0) {
  if (node.type === "text") return node.cdata ? `<![CDATA[${node.value}]]>` : encodeXmlText(node.value);
  if (node.type === "comment") return `<!--${node.value}-->`;
  if (node.type === "pi") return `<?${node.value}?>`;
  if (node.type !== "element") throw new Error(`Cannot serialize XML node type: ${node.type}`);

  const attributes = Object.entries(node.attrs || {}).map(([name, value]) => ` ${name}="${encodeXmlAttribute(value)}"`).join("");
  if (!node.children.length) return `<${node.name}${attributes}/>`;
  return `<${node.name}${attributes}>${node.children.map(child => serializeXmlNode(child, 0)).join('')}</${node.name}>`;
}

function serializeXmlDocument(parsed) {
  if (typeof parsed.prefix === 'string') return parsed.prefix + serializeXmlNode(parsed.root) + parsed.suffix;
  const declaration = parsed.declaration || `<?xml version="1.0" encoding="UTF-8"?>`;
  return `${declaration}\n${parsed.doctype ? `${parsed.doctype}\n` : ""}${serializeXmlNode(parsed.root)}\n`;
}


function elementChildren(node, names) {
  return node.children.filter(child => child.type === 'element' && names.includes(child.name));
}

function childElement(node, name) {
  return node?.children.find(child => child.type === 'element' && child.name === name) || null;
}

function textOf(node) {
  if (!node || node.type !== 'element') return '';
  return node.children.map(child => child.type === 'text' ? child.value : child.type === 'element' ? textOf(child) : '').join('');
}


module.exports = { decodeEntities, parseXml, serializeXmlNode, serializeXmlDocument, elementChildren, childElement, textOf };
