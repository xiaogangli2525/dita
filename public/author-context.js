'use strict';
(function (root) {
  function createController(A) {
    const toolbar = document.getElementById('authorQuickTools'), selection = A.authorSelection;
    let target = null, composing = false;
    const shortcut = event => event.altKey && event.code === 'Slash' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
    const more = document.getElementById('quickMoreActions'), moreButton = toolbar.querySelector('[data-quick-more]');
    const elementOf = node => node.nodeType === 1 ? node : node.parentElement;
    function hide() { toolbar.hidden = true; target = null; more.hidden = true; moreButton.setAttribute('aria-expanded', 'false'); }
    function show() {
      if (composing || A.state.mode !== 'visual' || document.querySelector('dialog[open]')) return hide();
      const live = root.getSelection();
      if (!live?.rangeCount || !A.dom.visualEditor.contains(live.anchorNode) || !A.dom.visualEditor.contains(live.focusNode)) return hide();
      try {
        target = selection.capture();
        const block = selection.validateRange(target.range, target.surface, { body: true });
        if (block.matches('h2,h3,h4')) return hide();
        const begin = elementOf(target.range.startContainer), end = elementOf(target.range.endContainer), cell = begin.closest('td,th'), code = block.matches('pre');
        const link = begin.closest('[data-dita-source="xref"]');
        target.link = link && link === end.closest('[data-dita-source="xref"]') && !link.matches('.fn-ref') ? link : null;
        target.cellCommand = cell && cell === end.closest('td,th') ? A.authorCommands.capture(cell) : null;
        const touchesLink = Boolean(link) || [...block.querySelectorAll('[data-dita-source="xref"]')].some(node => target.range.intersectsNode(node));
        let tableError = '';
        if (target.cellCommand) try { root.DitaTableCore.inspect(target.cellCommand.node.closest('table')); } catch (error) { tableError = error.message; }
        for (const button of toolbar.querySelectorAll('button')) {
          button.hidden = false; button.disabled = false; button.removeAttribute('title');
          const action = button.dataset.quickAction, insert = button.dataset.quickInsert;
          if (button.dataset.quickFormat || action === 'clear') button.hidden = target.range.collapsed || code;
          if (['row-after', 'col-after', 'header'].includes(action)) { button.hidden = !target.cellCommand; button.disabled = Boolean(tableError); if (tableError) button.title = tableError; }
          if (action === 'header' && target.cellCommand) button.textContent = target.cellCommand.node.parentElement.parentElement.localName === 'thead' ? '改为正文行' : '设为表头';
          if (['edit-link', 'unlink'].includes(action)) button.hidden = !target.link;
          if (['fn', 'xref', 'image'].includes(insert) || action === 'reuse') button.hidden = code || touchesLink;
          if (insert === 'p') button.hidden = Boolean(target.cellCommand);
          if (insert === 'table') button.hidden = code;
          if (button.dataset.quickConvert) button.hidden = Boolean(cell);
          if (button.dataset.quickFormat) {
            const parts = target.range.collapsed ? [] : selection.textParts(target.range, block), tag = button.dataset.quickFormat;
            button.setAttribute('aria-pressed', String(parts.length > 0 && parts.every(part => {
              for (let node = part.node.parentElement; node && node !== block; node = node.parentElement) if ((node.dataset.ditaSource || node.localName) === tag) return true;
              return false;
            })));
          }
        }
        more.hidden = true; moreButton.setAttribute('aria-expanded', 'false');
        toolbar.hidden = false; position(block);
        toolbar.querySelector('button:not([hidden]):not(:disabled)').focus({ preventScroll: true });
      } catch { hide(); }
    }
    function position(block = selection.blockOf(target?.range.startContainer)) {
      if (!target || !block) return;
        const bounds = A.dom.visualEditor.getBoundingClientRect(), rect = target.range.getBoundingClientRect();
        const anchor = rect.height ? rect : block.getBoundingClientRect();
        if (anchor.bottom < bounds.top || anchor.top > bounds.bottom) return hide();
        const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
        toolbar.style.left = Math.max(8, Math.min(root.innerWidth - width - 8, anchor.left)) + 'px';
        const above = anchor.top - height - 8;
        toolbar.style.top = Math.max(bounds.top + 4, Math.min(root.innerHeight - height - 8, above >= bounds.top ? above : anchor.bottom + 8)) + 'px';
    }
    toolbar.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || !target) return;
      if (button.disabled || button.hidden) return;
      if (button.hasAttribute('data-quick-more')) { more.hidden = !more.hidden; button.setAttribute('aria-expanded', String(!more.hidden)); position(); return; }
      const saved = target;
      try {
        selection.check(saved); selection.restoreTarget(saved); hide();
        if (button.dataset.quickFormat) A.editorTools.format(button.dataset.quickFormat);
        else if (button.dataset.quickConvert) A.authorBlocks.convert(button.dataset.quickConvert);
        else if (button.dataset.quickInsert) A.editorTools.insert(button.dataset.quickInsert);
        else {
          const action = button.dataset.quickAction;
          if (action === 'clear') A.editorTools.clearFormat();
          else if (action === 'reuse') A.noteReuse.show();
          else if (action === 'edit-link') A.resources.edit(saved.link);
          else if (action === 'unlink') { A.authorCommands.context(A.authorCommands.capture(saved.link), 'unlink'); A.setStatus('已取消链接，保留文字、格式与型号条件；可撤销'); }
          else { A.authorCommands.context(saved.cellCommand, action); A.setStatus('表格已更新，可撤销；保存后写入工作区'); }
        }
      } catch (error) { hide(); A.setStatus(error.message, true); }
    });
    toolbar.addEventListener('keydown', event => {
      if (event.key === 'Escape' || shortcut(event)) { event.preventDefault(); if (event.repeat) return; const saved = target; hide(); try { if (saved) selection.restoreTarget(saved); } catch { /* stale selection */ } }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = [...toolbar.querySelectorAll('button')].filter(button => !button.disabled && button.getClientRects().length), index = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    });
    A.dom.visualEditor.addEventListener('keydown', event => {
      if (shortcut(event)) { event.preventDefault(); if (!event.repeat) show(); }
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
