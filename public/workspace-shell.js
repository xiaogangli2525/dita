'use strict';
(function (root) {
  function createController(A) {
    const { state, dom } = A;
    const get = id => document.getElementById(id);
    const layout = document.querySelector('.layout');
    let panel = null, opener = null;
    function renderPanel() {
      dom.inspector.hidden = !panel;
      layout.classList.toggle('panel-open', Boolean(panel));
      dom.inspector.classList.toggle('notes-open', panel === 'notes');
      dom.inspector.classList.toggle('reviewing', panel === 'review');
      dom.inspectorTitle.textContent = ({ properties: '元素属性', notes: '型号注脚', review: '审阅变更' })[panel] || '辅助面板';
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
    function sidebar(open) {
      document.body.classList.toggle('sidebar-open', open);
      get('sidebarToggleButton').setAttribute('aria-expanded', String(open));
    }
    document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
      if (panel === button.dataset.panel) closePanel();
      else openPanel(button.dataset.panel);
    }));
    get('propertiesTab').addEventListener('click', () => openPanel('properties'));
    get('footnotesTab').addEventListener('click', () => openPanel('notes'));
    get('inspectorCloseButton').addEventListener('click', () => closePanel());
    get('sidebarToggleButton').addEventListener('click', () => sidebar(!document.body.classList.contains('sidebar-open')));
    document.addEventListener('keydown', event => {
      // Modal dialogs own Escape; closing a form must not also dismiss its panel.
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      sidebar(false);
      if (panel) closePanel();
    });
    A.events.on('file:opened', () => sidebar(false));
    A.events.on('workspace:willChange', () => closePanel({ restoreFocus: false }));

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
    const measure = () => document.documentElement.style.setProperty('--workspace-header-bottom', Math.ceil(document.querySelector('.app-header').getBoundingClientRect().bottom) + 'px');
    new ResizeObserver(measure).observe(document.querySelector('.app-header'));
    measure(); renderPanel();
    return { openPanel, closePanel, syncMode, sidebar };
  }
  root.DitaWorkspaceShell = { createController };
})(window);
