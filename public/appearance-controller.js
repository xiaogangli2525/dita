'use strict';
(function (root) {
  function createController(A) {
    const { theme } = A;
    const document = root.document, dialog = document.getElementById('appearanceDialog');
    const choices = document.getElementById('appearanceChoices'), hint = document.getElementById('appearanceHint');
    const button = document.getElementById('appearanceButton');
    let opener, writing = null, source = null;
    for (const preset of theme.themes) {
      const label = document.createElement('label'); label.className = 'theme-choice'; label.dataset.option = preset.id;
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'appearance'; radio.value = preset.id;
      radio.setAttribute('aria-label', preset.label); radio.setAttribute('aria-describedby', 'themeDescription-' + preset.id);
      const preview = document.createElement('span'); preview.className = 'theme-preview'; preview.dataset.preview = preset.id; preview.setAttribute('aria-hidden', 'true');
      for (const name of ['navigation', 'paper', 'tools']) { const part = document.createElement('span'); part.className = 'theme-preview-' + name; preview.append(part); }
      const heading = document.createElement('span'); heading.className = 'theme-name'; heading.textContent = preset.label;
      const check = document.createElement('span'); check.className = 'theme-selected'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true'); heading.append(check);
      const description = document.createElement('small'); description.id = 'themeDescription-' + preset.id; description.textContent = preset.description;
      label.append(radio, preview, heading, description); choices.append(label);
      radio.addEventListener('change', () => { if (radio.checked) theme.set(preset.id); });
    }
    function sync() {
      for (const radio of choices.querySelectorAll('input')) radio.checked = radio.value === theme.value;
      const selected = theme.themes.find(preset => preset.id === theme.value);
      button.title = '界面外观 · ' + selected.label;
      hint.textContent = theme.stored ? '选择立即生效，自动记住此浏览器的偏好。' : '选择已生效；此浏览器未允许保存设置，仅本次打开有效。';
    }
    theme.subscribe(sync); sync();
    function show() {
      if (document.querySelector('dialog[open]')) return;
      opener = document.activeElement;
      source = opener?.id === 'editor' ? { element: opener, value: opener.value,
        start: opener.selectionStart, end: opener.selectionEnd, direction: opener.selectionDirection,
        top: opener.scrollTop, left: opener.scrollLeft } : null;
      try { writing = A.authorSelection.capture(); }
      catch { writing = null; /* Appearance also opens without an Author caret. */ }
      sync(); dialog.showModal();
      choices.querySelector('input:checked')?.focus({ preventScroll: true });
    }
    // Keep a writer as the dialog's focus return target when using the rail.
    button.addEventListener('mousedown', event => {
      if (document.activeElement?.matches('#editor,[contenteditable="true"],[contenteditable="plaintext-only"]')) event.preventDefault();
    });
    button.addEventListener('click', show);
    document.getElementById('appearanceClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      const input = source; source = null;
      if (input?.element.isConnected && !input.element.disabled && input.element.value === input.value) {
        input.element.setSelectionRange(input.start, input.end, input.direction);
        input.element.scrollTop = input.top; input.element.scrollLeft = input.left;
      }
      const target = writing; writing = null;
      if (A.authorSelection.connected(target) && target.current === target.file.current && target.surface.ditaSourceContent === target.current) A.authorSelection.restoreTarget(target);
    });
    return { show };
  }
  root.DitaAppearance = { createController };
})(window);
