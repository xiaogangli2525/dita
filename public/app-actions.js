'use strict';
(function (root) {
  function createController(A, view) {
    const { state, dom, setStatus, setFileContent, setMode, undoFile, redoFile, markDirty, syncVisualToModel, renderDiff, renderMapReview, reviewAll } = A;
    const { setActiveView, renderWorkspaceSearch } = view;
    const saveFile = () => A.save.saveCurrent(), saveAsFile = () => A.documents.saveAsFile(), downloadFile = () => A.documents.downloadFile();
    const createNewDocument = () => A.documents.createNewDocument(), openFindReplace = () => A.editorTools.openFind();
    const applyMapOperation = (...args) => A.maps.applyOperation(...args), promptMapTarget = () => A.maps.promptTarget();
    const updateTree=filter=>A.maps.updateTree(filter);
    const selectBranch = () => A.workspace.selectBranch(), selectRepository = () => A.workspace.selectRepository();
    const validateXml = A.validateXml, formatContent = root.DitaXmlSource.formatXml;
    function selectedAuthorElement(target) {
      if (!target || !dom.visualEditor?.contains(target)) return null;
      const element = target.closest('[data-dita-source], .note, pre, img, table, li, ul, ol, h2, p');
      if (!element || element === dom.visualEditor || element.getAttribute('data-dita-body') === 'true') return null;
      return element;
    }

    function renderInspector(element = state.selectedVisualElement) { A.inspector?.render(element); }
    function applyContextAction(action) { A.inspector?.context(action); }

    const menuDefinitions = {
      file: [['恢复草稿', () => A.drafts.show()], ['交付记录', () => document.getElementById('releasesButton').click()], ['新建文档', () => createNewDocument()], ['保存', () => saveFile(), 'Ctrl+S'], ['另存为', () => saveAsFile()], ['下载', () => downloadFile()]],
      edit: [['撤销', () => undoFile(), 'Ctrl+Z'], ['重做', () => redoFile(), 'Ctrl+Y'], ['查找和替换', () => openFindReplace(), 'Ctrl+F'], ['AI 辅助写作', () => A.aiAuthoring.show()], ['格式化 XML', () => dom.formatButton?.click()]],
      view: [['源码编辑', () => setMode('editor')], ['编写', () => setMode('visual')], ['阅读（只读）', () => setMode('preview')], ['文档导航', () => setActiveView('map')], ['文档大纲', () => setActiveView('outline')], ['界面外观', () => A.appearance.show()]],
      dita: [['项目型号清单', () => A.project.show()], ['插入元素', () => dom.insertElementButton?.click()], ['XML 语法校验', () => dom.validateButton?.click()], ['审阅变更', () => setMode('review')]],
      help: [['快捷键', () => A.shell.showShortcuts()]]
    };

    for(const group of Object.values(menuDefinitions))for(const item of group){
      if(['保存','另存为','下载','查找和替换','源码编辑','编写','阅读（只读）','XML 语法校验','审阅变更'].includes(item[0]))item[3]=()=>Boolean(state.activePath);
      if(item[0]==='撤销')item[3]=()=>!dom.undoButton.disabled;
      if(item[0]==='重做')item[3]=()=>!dom.redoButton.disabled;
      if(item[0]==='格式化 XML')item[3]=()=>Boolean(state.activePath)&&!dom.formatButton.disabled;
      if(item[0]==='插入元素')item[3]=()=>Boolean(state.activePath)&&!dom.insertElementButton.disabled;
    }
    const menus = root.DitaMenuController.createController({ popup:dom.menuPopup, buttons:[...document.querySelectorAll('.main-menu [data-menu]')], definitions:menuDefinitions, setStatus });
    document.addEventListener('click', event => {
      const tools = document.querySelector('.editing-tools');
      if (tools && !tools.contains(event.target)) tools.open = false;
    });
    document.getElementById('welcomeNewButton')?.addEventListener('click', createNewDocument);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      menus.close();
    });

    dom.editor.addEventListener('input', markDirty);
    dom.visualEditor.addEventListener('input', syncVisualToModel);
    dom.visualEditor.addEventListener('click', event => {
      const element = selectedAuthorElement(event.target);
      if (!element || state.mode !== 'visual') return;
      event.stopPropagation();
      renderInspector(element);
      A.footnotes?.syncMode();
    });
    dom.visualEditor.addEventListener('keyup', event => {
      const element = selectedAuthorElement(event.target);
      if (element && state.mode === 'visual') { renderInspector(element); A.footnotes?.syncMode(); }
    });
    dom.visualEditor.addEventListener('focusout', () => {
      if (state.mode !== 'visual') renderInspector(null);
    });
    dom.search.addEventListener('input', () => updateTree(dom.search.value));
    for (const button of dom.viewTabs || []) button.addEventListener('click', () => setActiveView(button.dataset.view));
      for (const tl of dom.viewTabs || []) tl.addEventListener('keydown', (e) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const tabs = dom.viewTabs || [];
        const idx = tabs.indexOf(tl);
        const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:e.key === 'ArrowLeft' ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        tabs[next].focus();
        setActiveView(tabs[next].dataset.view);
      });
    dom.workspaceSearchInput?.addEventListener('input', () => renderWorkspaceSearch(dom.workspaceSearchInput.value));
    dom.contextToolbar?.addEventListener('click', event => {
      const button = event.target.closest('[data-context-action]');
      if (button && dom.contextToolbar.contains(button)) applyContextAction(button.dataset.contextAction);
    });
    dom.sourceButton.addEventListener('click', () => setMode('editor'));
    dom.visualButton.addEventListener('click', () => setMode('visual'));
    dom.previewButton.addEventListener('click', () => setMode('preview'));
    dom.newDocumentButton?.addEventListener('click', createNewDocument);
    dom.validateButton.addEventListener('click', () => {
      const file = state.filesMap.get(state.activePath);
      if (!file) return;
      try {
        setStatus(validateXml(file.current).message);
      } catch (error) {
        setStatus(`\u6821\u9A8C\u5931\u8D25\uFF1A${error.message}`, true);
      }
    });
    dom.saveButton.addEventListener('click', saveFile);
    dom.saveAsButton?.addEventListener('click', saveAsFile);
    dom.downloadButton?.addEventListener('click', downloadFile);
    dom.previewHtmlButton?.addEventListener('click', () => A.previewMapHtml());
    dom.exportHtmlButton?.addEventListener('click', () => A.exportMapToHtmlFile());
    dom.closeHtmlPreviewButton?.addEventListener('click', () => { dom.htmlPreviewPane.classList.remove('active'); dom.htmlPreviewFrame.src = ''; setMode(state.mode); });
    dom.previewMdButton?.addEventListener('click', () => A.previewMapMd());
    dom.exportMdButton?.addEventListener('click', () => A.exportMapToMarkdownFile());
    dom.exportMenuButton?.addEventListener('click', (e) => { e.stopPropagation(); A.openModelExport(); });
    dom.closeMdPreviewButton?.addEventListener('click', () => { dom.mdPreviewPane.classList.remove('active'); dom.mdPreviewContent.innerHTML = ''; setMode(state.mode); });
    dom.branchSelect.addEventListener('change', selectBranch);
    dom.undoButton?.addEventListener('click', undoFile);
    dom.redoButton?.addEventListener('click', redoFile);
    dom.authorUndoButton?.addEventListener('click', undoFile);
    dom.authorRedoButton?.addEventListener('click', redoFile);
    dom.formatButton.addEventListener('click', () => {
      const file = state.filesMap.get(state.activePath);
      if (!file) return;
      try {
        setFileContent(file, formatContent(file.current));
        setStatus('\u5DF2\u683C\u5F0F\u5316');
      } catch (error) {
        setStatus(`\u683C\u5F0F\u5316\u5931\u8D25\uFF1A${error.message}`, true);
      }
    });
    dom.moveMapUpButton.addEventListener('click', () => applyMapOperation('moveUp'));
    dom.moveMapDownButton.addEventListener('click', () => applyMapOperation('moveDown'));
    dom.promoteMapButton.addEventListener('click', () => applyMapOperation('promote'));
    dom.demoteMapButton.addEventListener('click', () => applyMapOperation('demote'));
    dom.removeMapButton.addEventListener('click', () => {
      if (confirm('确定删除选中的 Map 节点吗？')) applyMapOperation('remove');
    });
    dom.addTopicrefButton.addEventListener('click', () => {
      const href = promptMapTarget();
      if (href) applyMapOperation('addTopicref', { href });
    });
    dom.addTopicheadButton.addEventListener('click', () => {
      const title = prompt('请输入分组标题：');
      if (title?.trim()) applyMapOperation('addTopichead', { title: title.trim(), sourcePath: '' });
    });
    dom.reviewButton.addEventListener('click', () => setMode('review'));
    dom.closeReviewButton.addEventListener('click', () => setMode('visual'));
    dom.acceptAllButton.addEventListener('click', () => reviewAll(true));
    dom.rejectAllButton.addEventListener('click', () => reviewAll(false));
    dom.reviewScope.addEventListener('change', () => {
      const file = state.filesMap.get(state.activePath);
      if (file && /\.ditamap$/i.test(file.path)) renderMapReview(file); else renderDiff(file);
    });
    dom.repositorySelect.addEventListener('change', selectRepository);

    document.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229 || document.querySelector('dialog[open]')) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if(A.workspace.busy){event.preventDefault();return;}
      // Leave native undo/redo available for the workspace search and other
      // controls; the shared history applies to the source and visual editors.
      const targetTag = event.target?.tagName;
      if (targetTag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(targetTag) && event.target !== dom.editor) return;
      const key = event.key.toLowerCase();
      if (key === 'f' || key === 'h') {
        event.preventDefault();
        openFindReplace();
        return;
      }
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoFile();
        else undoFile();
        return;
      }
      if (key === 'y' && !event.shiftKey) {
        event.preventDefault();
        redoFile();
        return;
      }
      if (key === 's' && !event.shiftKey) {
        event.preventDefault();
        saveFile();
      }
    });

    window.addEventListener('beforeunload', event => {
      if (!Array.from(state.filesMap.values()).some(file => file.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    });

    return { menus };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAppActions = api;
})(typeof window === 'undefined' ? globalThis : window);
