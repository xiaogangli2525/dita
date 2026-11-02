'use strict';
(function (root) {
  function createView(A, { openFile, closeFile, setMode, updateTree }) {
    const { state, dom, ditaCore } = A;
    const fileNameFromPath = value => String(value || '').split('/').pop() || 'document.dita';
    function setSwitching(busy) {
      for (const node of document.querySelectorAll('.app-header,.layout')) node.inert = busy;
      document.querySelector('.layout').setAttribute('aria-busy', String(busy));
    }
    function updateDocumentChrome() {
      const file = state.filesMap.get(state.activePath);
      const title = document.getElementById('documentTitle');
      const location = document.getElementById('documentLocation');
      const badge = document.getElementById('documentSaveState');
      const empty = document.getElementById('welcomePanel');
      if (title) title.textContent = file ? A.documentLabel(file) : '你的文档工作台';
      if (location) location.textContent = file ? file.path : '选择一个文档，开始专注写作';
      if (badge) {
        const scope = new Set([state.activePath, ...(/\.ditamap$/i.test(state.activePath) ? state.mapAuthorPaths || [] : [])]);
        const dirty = [...scope].filter(path => state.filesMap.get(path)?.dirty).length;
        badge.textContent = A.saving ? '正在保存…' : dirty ? `${dirty} 个文档待保存` : file ? (state.capabilities.persistence === 'browser' ? '已保存到浏览器' : '已保存到磁盘') : '本地工作区';
        badge.dataset.state = A.saving ? 'saving' : dirty ? 'dirty' : 'saved';
      }
      if (empty) empty.hidden = Boolean(file);
      for(const control of [dom.saveButton,dom.saveAsButton,dom.downloadButton,dom.validateButton,dom.sourceButton,dom.visualButton,dom.previewButton,dom.reviewButton,dom.exportMenuButton])if(control)control.disabled=!file;
      A.authorNotes?.syncMode();
      document.title = file ? `${fileNameFromPath(file.path)} · DITA Lite` : 'DITA Lite · 文档工作台';
    }

    function setStatus(message, isError = false) {
      dom.status.textContent = message;
      dom.status.classList.toggle('status-error', isError);
      if (isError) console.error(message);
    }

    let toastTimer;
    function toast(message, level) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = message;
      el.className = 'toast show toast-' + (level || 'info');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
    }
    function setActiveView(view) {
      state.activeView = view;
      const panels = { map: dom.mapView, outline: dom.outlineView, search: dom.searchView };
      for (const [name, panel] of Object.entries(panels)) {
        if (!panel) continue;
        panel.hidden = name !== view;
        panel.classList.toggle('active', name === view);
      }
      for (const button of dom.viewTabs || []) { const active=button.dataset.view===view;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;button.id='navigationTab-'+button.dataset.view;button.setAttribute('aria-controls',button.dataset.view+'View'); }
      for(const [name,panel]of Object.entries(panels)){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','navigationTab-'+name);}
      if (view === 'outline') renderOutline();
      if (view === 'search') renderWorkspaceSearch(dom.workspaceSearchInput?.value || '');
    }

    function renderOutline() {
      if (!dom.outline) return;
      dom.outline.replaceChildren();
      const file = state.filesMap.get(state.activePath);
      if (!file || /\.ditamap$/i.test(file.path)) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = file ? 'Map 文档没有 Author 大纲。' : '打开文档后显示标题和节结构。';
        dom.outline.append(empty);
        return;
      }
      try {
        const root = ditaCore.parseXml(file.current).documentElement;
        const titles = Array.from(root.querySelectorAll('title'));
        if (!titles.length) throw new Error('empty');
        const projected=ditaCore.createAuthorTopic(file.current,document,false,file.path);
        const headings=Array.from(projected.querySelectorAll('h2,h3,h4,h5,h6'));
        const nodePath=node=>{const parts=[];while(node.parentElement){parts.unshift(Array.from(node.parentElement.children).indexOf(node));node=node.parentElement;}return parts.join('/');};
        titles.forEach((title, index) => {
          const path=nodePath(title),heading=headings.find(node=>node.ditaSourcePath===path);if(!heading)return;
          const item = document.createElement('button');
          item.type = 'button';
          item.className = `outline-item level-${Math.min(3, heading?.localName === 'h2' ? 1 : heading?.localName === 'h3' ? 2 : 3)}`;
          item.textContent = title.textContent.trim() || '(无标题)';
          item.title = title.textContent.trim();
          item.addEventListener('click', () => {
            if (/\.ditamap$/i.test(file.path)) return;
            setMode(state.mode === 'preview' ? 'preview' : 'visual');
            const target=Array.from(dom.visualEditor.querySelectorAll('h2,h3,h4,h5,h6')).find(node=>node.ditaSourcePath===path);
            target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            target?.classList.add('author-focus');
            setTimeout(() => target?.classList.remove('author-focus'), 900);
          });
          dom.outline.append(item);
        });
      } catch {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = '当前文档无法生成大纲。';
        dom.outline.append(empty);
      }
    }

    function renderWorkspaceSearch(term = '') {
      if (!dom.workspaceSearchResults) return;
      const query = term.trim().toLowerCase();
      dom.workspaceSearchResults.replaceChildren();
      const matches = flattenFiles(state.files).filter(path => !query || path.toLowerCase().includes(query));
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = query ? '没有匹配文件路径。' : '输入文件名搜索。';
        dom.workspaceSearchResults.append(empty);
        return;
      }
      for (const path of matches.slice(0, 100)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace-result';
        button.textContent = path.split('/').pop();
        const detail = document.createElement('small');
        detail.textContent = path;
        button.append(detail);
        button.addEventListener('click', () => { Promise.resolve(openFile(path)).catch(error=>setStatus(error.message,true)); });
        dom.workspaceSearchResults.append(button);
      }
    }

    function flattenFiles(nodes, result = []) {
      for (const node of nodes) {
        if (node.type === 'directory') flattenFiles(node.children, result);
        else result.push(node.path);
      }
      return result;
    }

    function fillSelect(select, items, selectedValue, renderOption) {
      select.replaceChildren();
      for (const item of items) {
        const option = document.createElement('option');
        renderOption(option, item);
        select.append(option);
      }
      select.value = selectedValue;
      select.title = select.selectedOptions[0]?.textContent || '';
    }

    function renderWorkspaceSwitches() {
      fillSelect(dom.repositorySelect, state.repositories, state.root, (option, repository) => {
        option.value = repository.path;
        option.textContent = repository.name;
      });
      fillSelect(dom.branchSelect, state.branches, state.currentBranch, (option, branch) => {
        option.value = branch.name;
        option.textContent = `${branch.name} (${branch.commit})`;
      });
    }

    function makeTab(file) {
      const tab = document.createElement('div');
      tab.className = 'tab active';
      tab.dataset.path = file.path;
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(file.path===state.activePath));tab.tabIndex=file.path===state.activePath?0:-1;
      const label = document.createElement('span');
      label.textContent = A.documentLabel(file);
      tab.title = file.path;
      const dirty = document.createElement('span');
      dirty.className = 'dirty';
      const mapDirty = /\.ditamap$/i.test(file.path) && Array.from(state.mapAuthorPaths || []).some(path => state.filesMap.get(path)?.dirty);
      dirty.hidden = !(file.dirty || mapDirty);
      tab.setAttribute('aria-label',label.textContent+(dirty.hidden?'':'，未保存'));
      dirty.textContent = '\u25CF';
      const close = document.createElement('button');
      close.className = 'close';
      close.textContent = '\u00D7';
      close.addEventListener('click', event => {
        event.stopPropagation();
        closeFile(file.path);
      });
      tab.append(label, dirty, close);
      tab.addEventListener('click', () => { Promise.resolve(openFile(file.path)).catch(error=>setStatus(error.message,true)); });
      tab.addEventListener('keydown',event=>{
        if(event.target!==tab)return;
        const tabs=[...dom.tabs.children],index=tabs.indexOf(tab);let next;
        if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
          event.preventDefault();next=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
        }else if(event.key==='Enter'||event.key===' '){event.preventDefault();next=tab;}
        else if(event.key==='Delete'){event.preventDefault();closeFile(file.path);[...dom.tabs.children].find(node=>node.dataset.path===state.activePath)?.focus();return;}
        if(next){const path=next.dataset.path;Promise.resolve(openFile(path)).then(()=>[...dom.tabs.children].find(node=>node.dataset.path===path)?.focus()).catch(error=>setStatus(error.message,true));}
      });
      close.setAttribute('aria-label', '关闭 ' + label.textContent);
      return tab;
    }

    function renderTabs() {
      updateDocumentChrome();
      A.footnotes?.scheduleRefresh();
      const fragment = document.createDocumentFragment();
      for (const file of state.filesMap.values()) {
        if (/\.ditamap$/i.test(state.activePath) && state.mapAuthorPaths?.has(file.path)) continue;
        const tab = makeTab(file);
        tab.classList.toggle('active', file.path === state.activePath);
        fragment.append(tab);
      }
      dom.tabs.replaceChildren(fragment);
      dom.tabs.hidden = dom.tabs.children.length < 2;
      dom.tabs.setAttribute('role','tablist');dom.tabs.setAttribute('aria-label','已打开的文档');
      if(state.activeView==='outline')renderOutline();
    }


    function showLoading(){const el=document.getElementById('loadingOverlay');el?.classList.add('active');el?.setAttribute('aria-hidden','false');}
    function hideLoading(){const el=document.getElementById('loadingOverlay');el?.classList.remove('active');el?.setAttribute('aria-hidden','true');}
    return { updateDocumentChrome, setStatus, toast, renderTabs, renderOutline, renderWorkspaceSearch, setActiveView, renderWorkspaceSwitches, setSwitching, showLoading, hideLoading };
  }
  const api = { createView };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaWorkspaceView = api;
})(typeof window === 'undefined' ? globalThis : window);
