'use strict';
(function (root) {
  function createController(A) {
    const toolbar = document.getElementById('authorQuickTools'), selection = A.authorSelection;
    let target = null, composing = false, frame = 0;
    function hide() { toolbar.hidden = true; target = null; cancelAnimationFrame(frame); }
    function show({ keyboard = false } = {}) {
      if (composing || A.state.mode !== 'visual' || document.querySelector('dialog[open]')) return hide();
      const live = root.getSelection();
      if (!live?.rangeCount || !A.dom.visualEditor.contains(live.anchorNode) || !A.dom.visualEditor.contains(live.focusNode)) return hide();
      try {
        target = selection.capture();
        const block = selection.validateRange(target.range, target.surface, { body: true });
        if (block.matches('pre,h2,h3,h4')) return hide();
        for (const button of toolbar.querySelectorAll('[data-quick-format]')) {
          button.hidden = target.range.collapsed;
          const tag = button.dataset.quickFormat;
          const parts = target.range.collapsed ? [] : selection.textParts(target.range, block);
          button.setAttribute('aria-pressed', String(parts.length > 0 && parts.every(part => {
            for (let node = part.node.parentElement; node && node !== block; node = node.parentElement) if ((node.dataset.ditaSource || node.localName) === tag) return true;
            return false;
          })));
        }
        const bounds = A.dom.visualEditor.getBoundingClientRect(), rect = target.range.getBoundingClientRect();
        const anchor = rect.height ? rect : block.getBoundingClientRect();
        if (anchor.bottom < bounds.top || anchor.top > bounds.bottom) return hide();
        toolbar.hidden = false;
        const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
        toolbar.style.left = Math.max(8, Math.min(root.innerWidth - width - 8, anchor.left)) + 'px';
        const above = anchor.top - height - 8;
        toolbar.style.top = Math.max(bounds.top + 4, Math.min(root.innerHeight - height - 8, above >= bounds.top ? above : anchor.bottom + 8)) + 'px';
        if (keyboard) toolbar.querySelector('button:not([hidden])').focus({ preventScroll: true });
      } catch { hide(); }
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => show()); }
    toolbar.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || !target) return;
      const saved = target;
      try {
        selection.check(saved); selection.restoreTarget(saved); hide();
        if (button.dataset.quickFormat) A.editorTools.format(button.dataset.quickFormat);
        else A.editorTools.insert(button.dataset.quickInsert);
      } catch (error) { hide(); A.setStatus(error.message, true); }
    });
    toolbar.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); const saved = target; hide(); try { if (saved) selection.restoreTarget(saved); } catch { /* stale selection */ } }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = [...toolbar.querySelectorAll('button:not([hidden])')], index = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    });
    A.dom.visualEditor.addEventListener('pointerup', schedule);
    A.dom.visualEditor.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) schedule(); });
    A.dom.visualEditor.addEventListener('keydown', event => {
      if (event.altKey && event.code === 'Slash' && !event.isComposing) { event.preventDefault(); show({ keyboard: true }); }
      else hide();
    });
    A.dom.visualEditor.addEventListener('compositionstart', () => { composing = true; hide(); });
    A.dom.visualEditor.addEventListener('compositionend', () => { composing = false; });
    A.dom.visualEditor.addEventListener('input', hide);
    document.addEventListener('pointerdown', event => { if (!toolbar.contains(event.target)) hide(); });
    document.addEventListener('focusin', event => { if (!toolbar.contains(event.target) && !A.dom.visualEditor.contains(event.target)) hide(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !toolbar.contains(event.target)) hide(); });
    root.addEventListener('resize', hide); document.addEventListener('scroll', hide, true);
    for (const name of ['workspace:willChange', 'file:opening', 'file:closed', 'document:changed', 'author:rendered']) A.events.on(name, hide);
    return { hide };
  }
  root.DitaAuthorContext = { createController };
})(window);
