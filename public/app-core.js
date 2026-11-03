'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-dom') : root.DitaXmlDom;
  const author = typeof module !== 'undefined' ? require('./author-renderer') : root.DitaAuthorRenderer;
  const source = typeof module !== 'undefined' ? require('./author-source') : root.DitaAuthorSource;
  const oxygen = typeof module !== 'undefined' ? require('./oxygen-core') : root.DitaOxygenCore;
  const assets = typeof module !== 'undefined' ? require('./asset-core') : root.DitaAssetCore;
  const presentation = typeof module !== 'undefined' ? require('./document-presentation') : root.DitaDocumentPresentation;
  const deliveryFactory = typeof module !== 'undefined' ? require('./delivery-core') : root.DitaDeliveryCore;
  const diff = typeof module !== 'undefined' ? require('./diff-core') : root.DitaDiffCore;
  const delivery = deliveryFactory.createDeliveryCore({ parseXml: xml.parseXml,
    normalizeOxyPIs: oxygen.normalizeOxyPIs, resolveAssetPath: assets.resolveAssetPath });

  // Compatibility constants for existing integrations.
  const BODY_TAGS = presentation.bodies;
  const INLINE_TAGS = new Set(['p', 'li', 'entry', 'dt', 'dd', 'note', 'title']);
  const SKIP_TAGS = new Set(['topic', 'concept', 'reference', 'task', 'body', 'conbody', 'refbody', 'taskbody', 'shortdesc', 'section', 'example', 'fig', 'dl', 'dli']);
  function createAuthorTopic(content, documentRef = globalThis.document, normalizeOxy = false, topicPath = '', parsed = null) {
    return author.createAuthorTopic(content, documentRef, normalizeOxy, topicPath, parsed);
  }
  function renderDitaNode(node, documentRef = globalThis.document, context) {
    return author.renderDitaNode(node, documentRef, context);
  }
  function updateCurrentFromVisual(_state, dom, content) {
    return source.updateSource(content, dom.visualEditor);
  }
  function updateVisualFromXml(_state, dom, content, documentRef = dom.visualEditor.ownerDocument, normalizeOxy = false, topicPath = '') {
    const container = author.createAuthorTopic(content, documentRef, normalizeOxy, topicPath);
    dom.visualEditor.replaceChildren(...container.childNodes);
    dom.visualEditor.ditaSourceContent = content;
  }
  function createVisualApi(state, dom) {
    return {
      updateVisualFromXml(content, normalizeOxy) {
        updateVisualFromXml(state, dom, content, dom.visualEditor.ownerDocument, normalizeOxy, state.activePath || '');
      },
      visualToXml(content) {
        return source.updateSource(content ?? state.filesMap.get(state.activePath).current, dom.visualEditor);
      }
    };
  }
  const api = {
    BODY_TAGS, INLINE_TAGS, SKIP_TAGS, VISUAL_TO_DITA: source.VISUAL_TO_DITA,
    stripDocType: xml.stripDocType, parseXml: xml.parseXml, serializeXmlNode: xml.serializeXmlNode, cloneDitaNode: xml.cloneDitaNode,
    visualElementToDita: source.visualElementToDita, updateDitaBody: source.updateDitaBody, updateCurrentFromVisual,
    updateVisualFromXml, createAuthorTopic, renderDitaNode, createVisualApi,
    lineDiff: diff.lineDiff, inlineDiff: diff.inlineDiff, groupDiffRows: diff.groupDiffRows, applyDiffGroups: diff.applyDiffGroups,
    normalizeOxyPIs: oxygen.normalizeOxyPIs, collectOxyTrackedChanges: oxygen.collectOxyTrackedChanges,
    collectPreviewPaths: delivery.collectPreviewPaths, exportMapToHtml: delivery.exportMapToHtml,
    exportMapToMarkdown: delivery.exportMapToMarkdown, ditaToMarkdown: delivery.ditaToMarkdown,
    renderMarkdownToHtml: delivery.renderMarkdownToHtml, highlightMarkdown: delivery.highlightMarkdown
  };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') root.DitaVisualCore = api;
})(typeof window === 'undefined' ? globalThis : window);
