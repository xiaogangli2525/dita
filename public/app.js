'use strict';
(() => {
  const A = window.DitaApp = window.DitaApp || {};
  const ditaCore = window.DitaVisualCore, workspaceClient = window.DitaWorkspaceClient;
  const documentStore = window.DitaDocumentStore, events = window.DitaManualCore.createEvents();
  const state = {
    root: '',
    files: [],
    maps: [],
    selectedMap: '',
    repositories: [],
    branches: [],
    currentBranch: '',
    capabilities: { persistence: 'filesystem', git: true },
    filesMap: new Map(),
    activePath: '',
    // Oxygen Author opens documents in the structured visual editor. Source is
    // an explicit secondary mode for XML-oriented work.
    mode: 'visual',
    suppressVisualInput: false,
    reviewGroups: new Map(),
    reviewDecisions: new Map(),
    reviewPath: '',
    reviewBaseline: '',
    reviewCurrent: '',
    activeView: 'map',
    selectedVisualElement: null,
    mapAuthorPaths: new Set(),
    historyTargetPath: ''
  };

  const dom = window.DitaAppDom.createDom(document);
  const documentLabel = window.DitaDocumentLabel.documentLabel;
  const view = window.DitaWorkspaceView.createView({
    state, dom, ditaCore, documentLabel,
    get saving() { return A.saving; },
    get authorNotes() { return A.authorNotes; },
    get footnotes() { return A.footnotes; }
  }, {
    openFile: (...args) => openFile(...args),
    closeFile: (...args) => navigation.closeFile(...args),
    setMode: (...args) => setMode(...args)
  });
  const { updateDocumentChrome, setStatus, toast, renderTabs, renderOutline,
    renderWorkspaceSwitches, setActiveView } = view;

  function validateXml(text) {
    ditaCore.parseXml(text);
    return { valid: true, message: 'XML 语法有效' };
  }
  function renderInspector(element) { A.inspector?.render(element); }
  function updateTree(filter) { return A.maps.updateTree(filter); }
  function renderMapPicker() { return A.maps.renderPicker(); }
  function openFile(...args) { return navigation.openFile(...args); }

  // Preserve feature/proposal interfaces while keeping construction here.
  Object.assign(A, {
    state, dom, ditaCore, events, setStatus, toast, validateXml, openFile,
    api: workspaceClient, saving: false,
    downloadText: window.DitaBrowserFiles.downloadText,
    downloadXML: window.DitaBrowserFiles.downloadXML,
    refreshChrome: updateDocumentChrome,
    refreshFiles: () => { renderTabs(); updateHistoryButtons(); updateDocumentChrome(); },
    navigateToSource: (...args) => navigation.navigateToSource(...args),
    prepareProposal: (content, instruction = '') => documentStore.createProposal({
      file: state.filesMap.get(state.activePath), workspaceToken: workspaceClient.token,
      content, instruction
    }, validateXml),
    applyProposal: proposal => documentStore.applyProposal(proposal, {
      file: state.filesMap.get(state.activePath), workspaceToken: workspaceClient.token
    }, validateXml, setFileContent),
    showLoading: view.showLoading,
    hideLoading: view.hideLoading
  });
  const editor = window.DitaEditorController.createEditorController(Object.freeze({
    state, dom, ditaCore, events, api: workspaceClient, setStatus, validateXml,
    get authorSelection() { return A.authorSelection; }
  }), {
    documentLabel, renderTabs, renderOutline, renderInspector, updateTree,
    refreshChrome: updateDocumentChrome,
    beforeModeChange: () => A.releaseExportPreview?.(),
    modeChanged: () => {
      A.shell?.syncMode(); A.footnotes?.syncMode(); A.authorNotes?.syncMode();
      A.editorTools?.syncMode(); A.authorContext?.hide(); A.footnotes?.hidePeek();
    }
  });
  const { setFileContent, setMode, updateHistoryButtons, updateActivePanes,
    ensureMapAuthorFile } = editor;
  Object.assign(A, { setFileContent, setMode, applyAuthorEdit: editor.applyAuthorEdit });

  const navigation = window.DitaDocumentNavigation.createController({
    state, dom, ditaCore, events, api: workspaceClient,
    setMode, ensureMapAuthorFile, setStatus,
    get shell() { return A.shell; },
    get footnotes() { return A.footnotes; }
  }, { renderTabs, updateActivePanes, updateHistoryButtons, updateTree });
  const workspace = window.DitaWorkspaceController.createController({
    state, dom, events, api: workspaceClient, setStatus, toast,
    get project() { return A.project; },
    get footnotes() { return A.footnotes; },
    get saving() { return A.saving; },
    releaseExportPreview: () => A.releaseExportPreview?.()
  }, {
    renderWorkspaceSwitches, renderMapPicker, renderTabs, updateActivePanes,
    updateTree, setActiveView, setSwitching: view.setSwitching
  });
  A.workspace = workspace;
  window.DitaApplication.start(A, {
    maps: { ensureMapAuthorFile, renderTabs, documentLabel },
    documents: { renderTabs, updateActivePanes, updateTree,
      refreshWorkspaceTree: workspace.refreshWorkspaceTree },
    remoteLibraries: {
      reloadWorkspace: workspace.reloadWorkspace,
      loadRepositories: workspace.loadRepositories,
      openManual: async path => {
        state.selectedMap = path; renderMapPicker(); updateTree(''); await openFile(path);
      }
    }
  });
  window.DitaAppActions.createController({
    state, dom, setStatus, validateXml, setFileContent, setMode,
    undoFile: editor.undoFile,
    redoFile: editor.redoFile,
    markDirty: editor.markDirty,
    syncVisualToModel: editor.syncVisualToModel,
    renderDiff: editor.renderDiff,
    renderMapReview: editor.renderMapReview,
    reviewAll: editor.reviewAll,
    save: A.save, documents: A.documents, maps: A.maps, workspace,
    editorTools: A.editorTools, project: A.project, drafts: A.drafts,
    shell: A.shell, inspector: A.inspector, footnotes: A.footnotes,
    previewMapHtml: A.previewMapHtml,
    exportMapToHtmlFile: A.exportMapToHtmlFile,
    previewMapMd: A.previewMapMd,
    exportMapToMarkdownFile: A.exportMapToMarkdownFile,
    openModelExport: A.openModelExport
  }, view);
  workspace.initialize();
})();
