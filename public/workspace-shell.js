'use strict';
(function (root) {
  function createController(A) {
    const { state, dom } = A;
    const get = id => document.getElementById(id);
    const layout = document.querySelector('.layout');
    const mobileNavigation = root.matchMedia('(max-width:700px)');
    let panel = null, opener = null;
    function renderPanel() {
      dom.inspector.hidden = !panel;
      layout.classList.toggle('panel-open', Boolean(panel));
      dom.inspector.classList.toggle('notes-open', panel === 'notes');
      dom.inspector.classList.toggle('reviewing', panel === 'review');
      dom.inspectorTitle.textContent = ({ properties: '内容设置', notes: '型号注脚', review: '审阅变更' })[panel] || '辅助面板';
      dom.attributesPanel.hidden = panel !== 'properties';
      dom.inspectorElement.hidden = panel !== 'properties';
      if (panel !== 'properties') dom.contextToolbar.hidden = true;
      document.querySelector('.inspector-tabs').hidden = panel === 'review';
      for (const [id, name] of [['propertiesTab', 'properties'], ['footnotesTab', 'notes']]) {
        get(id).classList.toggle('active', panel === name);
        get(id).setAttribute('aria-selected', String(panel === name));
      }
      document.querySelectorAll('[data-panel]').forEach(button => {
        button.classList.toggle('active', button.dataset.panel === panel);
        button.setAttribute('aria-expanded', String(button.dataset.panel === panel));
      });
      dom.reviewButton.setAttribute('aria-expanded', String(panel === 'review'));
      A.footnotes.setVisible(panel === 'notes');
    }
    function openPanel(name) {
      opener = document.activeElement;
      if (name === 'review') { A.setMode('review'); return; }
      if (state.mode === 'review') A.setMode('visual');
      panel = name;
      if (name === 'properties') A.inspector.render();
      renderPanel();
    }
    function closePanel({ restoreFocus = true } = {}) {
      if (state.mode === 'review') A.setMode('visual');
      panel = null;
      renderPanel();
      if (restoreFocus && opener?.isConnected) opener.focus();
    }
    function syncMode() {
      if (state.mode === 'review') {
        if (panel !== 'review') opener = document.activeElement;
        panel = 'review';
      }
      else if (panel === 'review') panel = null;
      renderPanel();
      for (const [id, mode] of [['visualButton', 'visual'], ['previewButton', 'preview'], ['sourceButton', 'editor']]) get(id).setAttribute('aria-pressed', String(state.mode === mode));
    }
    function sidebar(open, { restoreFocus = false } = {}) {
      open = Boolean(open && mobileNavigation.matches);
      document.body.classList.toggle('sidebar-open', open);
      get('sidebarToggleButton').setAttribute('aria-expanded', String(open));
      get('sidebarBackdrop').hidden = !open;
      if (open) { if (panel) closePanel({ restoreFocus: false }); get('sidebarCloseButton').focus(); }
      else if (restoreFocus && mobileNavigation.matches) get('sidebarToggleButton').focus();
    }
    document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
      if (panel === button.dataset.panel) closePanel();
      else openPanel(button.dataset.panel);
    }));
    get('propertiesTab').addEventListener('click', () => openPanel('properties'));
    get('footnotesTab').addEventListener('click', () => openPanel('notes'));
    get('inspectorCloseButton').addEventListener('click', () => closePanel());
    get('sidebarToggleButton').addEventListener('click', () => sidebar(!document.body.classList.contains('sidebar-open')));
    for (const id of ['sidebarCloseButton', 'sidebarBackdrop']) get(id).addEventListener('click', () => sidebar(false, { restoreFocus: true }));
    document.addEventListener('keydown', event => {
      // Modal dialogs own Escape; closing a form must not also dismiss its panel.
      if (document.querySelector('dialog[open]')) return;
      const navigationOpen = mobileNavigation.matches && document.body.classList.contains('sidebar-open');
      if (navigationOpen && event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
        const controls = Array.from(get('workspaceSidebar').querySelectorAll('button, input, select, summary, [tabindex="0"]')).filter(node => !node.disabled && node.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1], focused = document.activeElement;
        if (first && (!get('workspaceSidebar').contains(focused) || focused === (event.shiftKey ? first : last))) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
      if (event.key !== 'Escape') return;
      sidebar(false, { restoreFocus: navigationOpen });
      if (panel) closePanel();
    });
    A.events.on('file:opened', () => sidebar(false));
    A.events.on('workspace:willChange', () => closePanel({ restoreFocus: false }));

    // Navigation width is a browser preference; it never enters document state.
    const sidebarResize = get('sidebarResize'), widthKey = 'dita-lite:sidebar-width';
    let preferredWidth = 296, navigationDrag = null;
    try { const saved = Number(root.localStorage.getItem(widthKey)); if (Number.isFinite(saved) && saved > 0) preferredWidth = Math.max(260, Math.min(400, saved)); } catch { /* Storage may be unavailable. */ }
    const maximumWidth = () => Math.max(260, Math.min(400, Math.floor(layout.clientWidth * .42)));
    function renderNavigationWidth() {
      const maximum = maximumWidth(), applied = Math.min(preferredWidth, maximum);
      layout.style.setProperty('--sidebar-width', applied + 'px');
      sidebarResize.setAttribute('aria-valuemax', String(maximum));
      sidebarResize.setAttribute('aria-valuenow', String(applied));
      sidebarResize.setAttribute('aria-valuetext', applied + ' 像素');
    }
    function rememberNavigationWidth() { try { root.localStorage.setItem(widthKey, String(preferredWidth)); } catch { /* Resizing remains usable without storage. */ } }
    function setNavigationWidth(value) { preferredWidth = Math.max(260, Math.min(maximumWidth(), Math.round(value))); renderNavigationWidth(); }
    function finishNavigationDrag() { if (!navigationDrag) return; navigationDrag = null; document.body.classList.remove('resizing-navigation'); rememberNavigationWidth(); }
    sidebarResize.addEventListener('pointerdown', event => {
      if (event.button !== 0 || mobileNavigation.matches) return;
      navigationDrag = { x: event.clientX, width: Number(sidebarResize.getAttribute('aria-valuenow')) };
      sidebarResize.setPointerCapture(event.pointerId); document.body.classList.add('resizing-navigation'); event.preventDefault();
    });
    sidebarResize.addEventListener('pointermove', event => { if (navigationDrag) setNavigationWidth(navigationDrag.width + event.clientX - navigationDrag.x); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) sidebarResize.addEventListener(event, finishNavigationDrag);
    sidebarResize.addEventListener('dblclick', () => { setNavigationWidth(296); rememberNavigationWidth(); });
    sidebarResize.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const current = Number(sidebarResize.getAttribute('aria-valuenow'));
      setNavigationWidth(event.key === 'Home' ? 260 : event.key === 'End' ? maximumWidth() : current + (event.key === 'ArrowRight' ? 16 : -16)); rememberNavigationWidth();
    });
    root.addEventListener('resize', () => { finishNavigationDrag(); renderNavigationWidth(); if (!mobileNavigation.matches) sidebar(false); });

    const resize = get('inspectorResize');
    let width = 320, drag = null;
    function setWidth(value) {
      width = Math.max(280, Math.min(480, value));
      layout.style.setProperty('--inspector-width', width + 'px');
      resize.setAttribute('aria-valuenow', String(width));
    }
    resize.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, width };
      resize.setPointerCapture(event.pointerId); event.preventDefault();
    });
    resize.addEventListener('pointermove', event => { if (drag) setWidth(drag.width + drag.x - event.clientX); });
    resize.addEventListener('lostpointercapture', () => { drag = null; });
    resize.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setWidth(event.key === 'Home' ? 280 : event.key === 'End' ? 480 : width + (event.key === 'ArrowLeft' ? 16 : -16));
    });
    const header = document.querySelector('.app-header'), footer = document.querySelector('.statusbar');
    const measure = () => {
      document.documentElement.style.setProperty('--workspace-header-bottom', Math.ceil(header.getBoundingClientRect().bottom) + 'px');
      document.documentElement.style.setProperty('--workspace-footer-height', Math.ceil(footer.getBoundingClientRect().height) + 'px');
    };
    const observer = new ResizeObserver(measure); observer.observe(header); observer.observe(footer);
    measure(); renderNavigationWidth(); renderPanel();
    return { openPanel, closePanel, syncMode, sidebar };
  }
  root.DitaWorkspaceShell = { createController };
})(window);
