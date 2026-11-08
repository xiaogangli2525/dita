'use strict';
(function (root) {
  const xmlSource = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;

  function stripDocType(text) {
    return text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/i, '');
  }

  // Return both representations from one validation pass. Source edits use the
  // validated ranges while rendering uses the DOM; neither re-lexes the XML.
  function parseSource(text, Parser = globalThis.DOMParser) {
    const tree = xmlSource.inspectSource(text);
    const document = new Parser().parseFromString(stripDocType(text), 'application/xml');
    const parserError = document.querySelector('parsererror');
    if (parserError) throw new Error(parserError.textContent.replace(/\s+/g, ' ').trim());
    return { document, tree };
  }
  function parseXml(text, Parser) { return parseSource(text, Parser).document; }

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


  const api = { stripDocType, parseXml, parseSource, serializeXmlNode, cloneDitaNode, elementChildren, xmlNodePath };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaXmlDom = api;
})(typeof window === 'undefined' ? globalThis : window);
