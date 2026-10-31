'use strict';
(function (root) {
  function createController({ state, dom, commands, format, status }) {
    let target = null;
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
    function attempt(action) { try { action(); } catch (error) { status(error.message, true); } }
    function render(element = state.selectedVisualElement) {
      state.selectedVisualElement?.classList.remove('author-selected'); target = null;
      state.selectedVisualElement = element && dom.visualEditor.contains(element) ? element : null;
      dom.attributesPanel.replaceChildren(); dom.contextToolbar.replaceChildren(); dom.contextToolbar.hidden = true;
      if (!state.selectedVisualElement || state.mode !== 'visual') { dom.inspectorElement.textContent = '未选择元素'; dom.attributesPanel.append(el('p', '在正文中选择元素，查看属性和表格操作。', 'inspector-empty')); return; }
      try { target = commands.capture(element); } catch (error) { dom.attributesPanel.append(el('p', error.message, 'inspector-empty')); return; }
      element.classList.add('author-selected'); const node = target.node, table = node.closest('table'), cell = node.closest('entry');
      dom.inspectorElement.textContent = '<' + node.localName + '>';
      dom.contextToolbar.hidden = false;
      let blocked = '';
      if (table) try { root.DitaTableCore.inspect(table); } catch (error) { blocked = error.message; }
      const addAction = (action, label, reason = '') => { const button = el('button', label); button.type = 'button'; button.dataset.contextAction = action; button.disabled = Boolean(reason); if (reason) button.title = reason; dom.contextToolbar.append(button); };
      if (table) {
        const reason = blocked || (!cell ? '请先选择一个单元格' : '');
        for (const [action, label] of [['row-before', '上方插行'], ['row-after', '下方插行'], ['row-delete', '删除行'], ['col-before', '左侧插列'], ['col-after', '右侧插列'], ['col-delete', '删除列'], ['header', cell?.parentElement.parentElement.localName === 'thead' ? '改为正文行' : '设为表头']]) addAction(action, label, reason);
        addAction('delete', '删除表格');
        if (blocked) dom.attributesPanel.append(el('p', blocked, 'inspector-empty'));
        if (cell && !blocked) {
          const label = el('label', '当前列宽'), input = el('input'), index = Array.from(cell.parentElement.children).indexOf(cell);
          input.value = root.DitaTableCore.inspect(table).specs[index]?.getAttribute('colwidth') || '1*'; input.setAttribute('aria-label', '当前列宽'); input.placeholder = '例如 1*、2*、30mm';
          input.addEventListener('change', () => context('width', input.value.trim())); label.append(input); dom.attributesPanel.append(label);
        }
      } else {
        addAction('before', '上方插入'); addAction('after', '下方插入');
        if (node.localName !== 'title') addAction('delete', '删除元素');
      }
      const writeAttribute = (name, value) => attempt(() => { commands.attribute(target, name, value); status('已更新属性：' + name + '，可撤销；保存后写入工作区'); });
      if (!node.attributes.length) dom.attributesPanel.append(el('p', '此元素没有属性，可在下方添加。', 'inspector-empty'));
      for (const attribute of node.attributes) {
        const row = el('label', attribute.name, 'attribute-row'), input = el('input'); input.value = attribute.value; input.dataset.attribute = attribute.name;
        input.addEventListener('change', () => writeAttribute(attribute.name, input.value)); row.append(input); dom.attributesPanel.append(row);
      }
      const form = el('form', '', 'attribute-add-form'), name = el('input'), value = el('input'), add = el('button', '添加属性');
      name.placeholder = '属性名，如 product'; name.setAttribute('aria-label', '新属性名'); name.required = true;
      value.placeholder = '属性值'; value.setAttribute('aria-label', '新属性值'); add.type = 'submit'; form.append(name, value, add);
      form.addEventListener('submit', event => { event.preventDefault(); writeAttribute(name.value.trim(), value.value); }); dom.attributesPanel.append(form);
    }
    function context(action, value) {
      if (!target) return;
      if (['bold', 'italic', 'code-inline'].includes(action)) return format(({ bold: 'b', italic: 'i', 'code-inline': 'codeph' })[action]);
      attempt(() => { commands.context(target, action, value); status('修改已应用，可撤销；保存后写入工作区'); });
    }
    return { render, context };
  }
  root.DitaInspector = { createController };
})(window);
