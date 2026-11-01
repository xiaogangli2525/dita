'use strict';
(function (root) {
  function createController({ state, dom, commands, editResource, openNotes, status }) {
    const names = { p: '段落', title: '标题', table: '表格', entry: '单元格', image: '图片', xref: '链接', note: '说明', li: '列表项', ul: '无序列表', ol: '有序列表', codeblock: '代码块', section: '章节', b: '粗体文字', i: '斜体文字', codeph: '行内代码', ph: '短语' };
    let target = null, selectedKey = null;
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
    function attempt(action) { try { action(); } catch (error) { status(error.message, true); } }
    function actionButton(action, label, reason = '') {
      const button = el('button', label); button.type = 'button'; button.dataset.contextAction = action;
      button.disabled = Boolean(reason); if (reason) button.title = reason; dom.contextToolbar.append(button);
    }
    function hint(text) { dom.attributesPanel.append(el('p', text, 'inspector-hint')); }
    function summary(label, value) {
      const row = el('div', '', 'content-setting-summary'); row.append(el('span', label), el('p', value || '未填写')); dom.attributesPanel.append(row);
    }
    function restoreTarget(previous, advancedOpen) {
      const element = Array.from(previous.surface.querySelectorAll('*')).find(node => node.ditaSourcePath === previous.xmlPath);
      render(element || null, { advancedOpen });
    }
    function writeAttribute(name, value) {
      const previous = target, advancedOpen = dom.attributesPanel.querySelector('details')?.open || false;
      if (!previous) return;
      const focused = dom.attributesPanel.contains(document.activeElement), selector = document.activeElement?.dataset.attribute ? '[data-attribute="' + CSS.escape(name) + '"]' : document.activeElement?.id === 'contentNoteType' ? '#contentNoteType' : null;
      attempt(() => {
        commands.attribute(previous, name, value);
        restoreTarget(previous, advancedOpen);
        if (focused && selector) dom.attributesPanel.querySelector(selector)?.focus();
        status('设置已更新，可撤销；保存后写入工作区');
      });
    }
    function render(element = state.selectedVisualElement, { advancedOpen = false } = {}) {
      const previousKey = selectedKey, wasOpen = dom.attributesPanel.querySelector('details')?.open || false;
      state.selectedVisualElement?.classList.remove('author-selected'); target = null; selectedKey = null;
      state.selectedVisualElement = element && dom.visualEditor.contains(element) ? element : null;
      dom.attributesPanel.replaceChildren(); dom.contextToolbar.replaceChildren(); dom.contextToolbar.hidden = true;
      if (!state.selectedVisualElement || state.mode !== 'visual') {
        dom.inspectorElement.textContent = '未选择内容'; hint('在正文中选择段落、表格、图片或链接，查看对应设置。'); return;
      }
      const marker = element.closest('[data-dita-source="fn"]');
      if (marker) {
        dom.inspectorElement.textContent = '型号注脚'; dom.contextToolbar.hidden = false;
        actionButton('open-notes', '打开型号注脚'); hint('注脚内容和适用型号统一在型号注脚面板中修改，也可以双击正文中的注脚标记。'); return;
      }
      // Clicking rich text inside a link/note selects its business settings.
      // A nested table keeps its own cell controls, and footnotes stay separate.
      const owner = element.closest('[data-dita-source="image"],[data-dita-source="xref"]') || (!element.closest('[data-dita-source="table"]') && element.closest('[data-dita-source="note"]'));
      if (owner) { element = owner; state.selectedVisualElement = owner; }
      try { target = commands.capture(element); }
      catch (error) { dom.inspectorElement.textContent = '引用或修订内容'; hint(error.message); return; }
      element.classList.add('author-selected'); const node = target.node, resource = ['image', 'xref'].includes(node.localName);
      const table = !resource && node.closest('table'), cell = table && node.closest('entry');
      selectedKey = [state.root, target.file.path, target.xmlPath].join('\0');
      dom.inspectorElement.textContent = table ? cell ? '单元格' : '表格' : names[node.localName] || '当前内容';
      dom.contextToolbar.hidden = false;
      if (table) {
        let blocked = ''; try { root.DitaTableCore.inspect(table); } catch (error) { blocked = error.message; }
        const reason = blocked || (!cell ? '请先选择一个单元格' : '');
        dom.contextToolbar.append(el('span', '表格操作', 'context-label'));
        for (const [action, label] of [['row-before', '上方插行'], ['row-after', '下方插行'], ['row-delete', '删除行'], ['col-before', '左侧插列'], ['col-after', '右侧插列'], ['col-delete', '删除列'], ['header', cell?.parentElement.parentElement.localName === 'thead' ? '改为正文行' : '设为表头']]) actionButton(action, label, reason);
        actionButton('delete', '删除表格');
        if (blocked) hint(blocked);
        if (cell && !blocked) {
          const label = el('label', '当前列宽', 'content-setting-field'), input = el('input'), index = Array.from(cell.parentElement.children).indexOf(cell);
          input.value = root.DitaTableCore.inspect(table).specs[index]?.getAttribute('colwidth') || '1*'; input.setAttribute('aria-label', '当前列宽'); input.placeholder = '例如 1*、2*、30mm';
          input.addEventListener('change', () => context('width', input.value.trim())); label.append(input); dom.attributesPanel.append(label);
          hint('1* 表示等分列宽，2* 表示两倍比例，30mm 表示固定宽度。');
        }
      } else if (resource) {
        const image = node.localName === 'image';
        actionButton('edit-resource', image ? '编辑图片' : '编辑链接'); actionButton('remove', image ? '删除图片' : '删除链接及文字');
        summary(image ? '图片说明' : '链接文字', image ? root.DitaAssetCore.imagePresentation(node).alt : node.textContent);
        if (image) summary('尺寸', [node.getAttribute('width'), node.getAttribute('height')].filter(Boolean).join(' × ') || '自适应');
        hint(image ? '通过“编辑图片”更换文件、修改说明或调整尺寸；双击图片也可打开同一窗口。' : '通过“编辑链接”修改目标和文字；双击链接也可打开同一窗口。');
      } else {
        if (node.localName !== 'title') actionButton('remove', '删除' + (names[node.localName] || '当前内容'));
        if (node.localName === 'note') {
          const label = el('label', '说明类型', 'content-setting-field'), select = el('select'); select.id = 'contentNoteType';
          const types = { note: '说明', tip: '提示', important: '重要', caution: '注意', warning: '警告' }, current = node.getAttribute('type') || 'note';
          if (!Object.hasOwn(types, current)) types[current] = '当前类型：' + current;
          for (const [value, text] of Object.entries(types)) { const option = el('option', text); option.value = value; select.append(option); }
          select.value = current; select.addEventListener('change', () => writeAttribute('type', select.value)); label.append(select); dom.attributesPanel.append(label);
        }
        hint(node.localName === 'codeblock' ? '在正文中编辑代码；Enter 换行，Tab / Shift+Tab 调整缩进。' : '文字直接在正文中修改；新增内容使用顶部“插入…”，调整正文类型使用“转换…”。');
      }
      const conditions = [];
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) { const product = ancestor.getAttribute('product')?.trim(); if (product) conditions.unshift(product); }
      if (conditions.length) {
        const callout = el('div', '', 'content-condition'); callout.append(el('strong', '型号条件：' + conditions.join(' ∩ ')), el('p', '此条件会约束其中的注脚；当前按型号交付不据此隐藏整段正文。注脚自身的型号请在型号注脚面板修改。')); dom.attributesPanel.append(callout);
      }
      const advanced = el('details', '', 'advanced-attributes'); advanced.id = 'advancedAttributes'; advanced.open = advancedOpen || selectedKey === previousKey && wasOpen;
      advanced.append(el('summary', '高级属性'), el('p', '源元素：<' + node.localName + '>。下方用于高级 DITA 设置，日常编写可保持收起。', 'inspector-hint'));
      if (!node.attributes.length) advanced.append(el('p', '当前没有自定义属性。', 'inspector-hint'));
      for (const attribute of node.attributes) {
        const row = el('label', attribute.name, 'attribute-row'), input = el('input'); input.value = attribute.value; input.dataset.attribute = attribute.name;
        input.addEventListener('change', () => writeAttribute(attribute.name, input.value)); row.append(input); advanced.append(row);
      }
      const form = el('form', '', 'attribute-add-form'), name = el('input'), value = el('input'), add = el('button', '添加属性');
      name.placeholder = '属性名，如 outputclass'; name.setAttribute('aria-label', '新属性名'); name.required = true;
      value.placeholder = '属性值'; value.setAttribute('aria-label', '新属性值'); add.type = 'submit'; form.append(name, value, add);
      form.addEventListener('submit', event => { event.preventDefault(); writeAttribute(name.value.trim(), value.value); }); advanced.append(form); dom.attributesPanel.append(advanced);
      if (!dom.contextToolbar.querySelector('button')) dom.contextToolbar.hidden = true;
    }
    function context(action, value) {
      if (action === 'open-notes') return openNotes();
      if (!target) return;
      if (action === 'edit-resource') return editResource(target.element);
      const previous = target, advancedOpen = dom.attributesPanel.querySelector('details')?.open || false;
      attempt(() => {
        commands.context(previous, action, value);
        if (!['delete', 'remove'].includes(action)) restoreTarget(previous, advancedOpen);
        status('修改已应用，可撤销；保存后写入工作区');
      });
    }
    return { render, context };
  }
  root.DitaInspector = { createController };
})(window);
