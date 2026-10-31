'use strict';

const { buildMockDom } = require('./dom-mock');
const { createVisualApi } = require('../public/app-core');

function createTestApp(source) {
  const { document } = buildMockDom();
  const state = {
    activePath: 'topic.dita',
    filesMap: new Map([['topic.dita', {
      path: 'topic.dita',
      disk: source,
      baseline: source,
      current: source,
      dirty: false,
      gitStatus: 'clean'
    }]])
  };
  const dom = {
    editor: document.createElement('textarea'),
    editorPane: document.createElement('div'),
    visualEditor: document.createElement('div'),
    visualPane: document.createElement('div'),
    preview: document.createElement('article'),
    previewPane: document.createElement('div'),
    reviewPane: document.createElement('div'),
    tabs: document.createElement('div'),
    status: document.createElement('span')
  };
  const visual = createVisualApi(state, dom);
  return { ...visual, state, dom, document, visualToXml() {
    const next = visual.visualToXml();
    require('../public/document-store').editDocument(state.filesMap.get(state.activePath), next);
    return next;
  } };
}

module.exports = { createTestApp, buildMockDom };

