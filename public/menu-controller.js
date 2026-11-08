'use strict';
(function (root) {
  function createController({ popup, buttons, definitions, setStatus }) {
    let owner = null;
    popup.setAttribute('role', 'menu');
    function close({ restoreFocus = false } = {}) {
      popup.hidden = true;
      for (const button of buttons) button.setAttribute('aria-expanded', 'false');
      if (restoreFocus && owner?.isConnected) owner.focus();
    }
    const enabledItems = () => [...popup.querySelectorAll('button')].filter(button => !button.disabled);
    function open(button, last = false) {
      if (document.querySelector('dialog[open]')) return;
      owner = button; popup.replaceChildren();
      for (const [label, action, shortcut, enabled] of definitions[button.dataset.menu] || []) {
        const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem');item.setAttribute('aria-label',label);
        item.disabled = enabled ? !enabled() : false; item.append(document.createTextNode(label));
        if (shortcut) { const key = document.createElement('kbd'); key.textContent = shortcut; item.append(key); }
        item.addEventListener('click', () => { close({ restoreFocus: true }); Promise.resolve().then(action).catch(error => setStatus(error.message, true)); });
        popup.append(item);
      }
      popup.hidden = false;
      for (const candidate of buttons) candidate.setAttribute('aria-expanded', String(candidate === button));
      const anchor = button.getBoundingClientRect(), bounds = popup.getBoundingClientRect();
      popup.style.left = Math.max(8, Math.min(anchor.left, root.innerWidth - bounds.width - 8)) + 'px';
      popup.style.top = Math.max(8, Math.min(anchor.bottom + 2, root.innerHeight - bounds.height - 8)) + 'px';
      const items = enabledItems(); (last ? items.at(-1) : items[0])?.focus();
    }
    for (const button of buttons) {
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', popup.id); button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', event => { event.stopPropagation(); if (!popup.hidden && owner === button) close({ restoreFocus: true }); else open(button); });
      button.addEventListener('keydown', event => { if (!event.isComposing && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(button, event.key === 'ArrowUp'); } });
    }
    popup.addEventListener('keydown', event => {
      const items = enabledItems(), index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); const index = buttons.indexOf(owner);
        open(buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]);
      } else if (event.key === 'Tab') close();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || popup.hidden || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); close({ restoreFocus: true });
    }, true);
    document.addEventListener('click', event => { if (!popup.contains(event.target) && !buttons.some(button => button.contains(event.target))) close(); }, true);
    root.addEventListener('resize', () => close());
    return { close, open };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaMenuController = api;
})(typeof window === 'undefined' ? globalThis : window);
