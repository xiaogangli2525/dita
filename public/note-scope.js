'use strict';
(function (root) {
  function createPicker(A, prefix, formId, productId) {
    const get = suffix => document.getElementById(prefix + suffix), form = document.getElementById(formId), productsInput = document.getElementById(productId);
    function sync() { get('ModelPicker').hidden = form.elements.scope.value !== 'models'; }
    function draw(note, defaultScope) {
      const selected = new Set(note.products || []), registered = A.project.value.models;
      const known = new Set(registered.length ? registered : Array.from(A.state.filesMap.values()).flatMap(file => {
        try { return root.DitaFootnotesCore.listFootnotes(file.current).flatMap(note => note.products); } catch { return []; }
      }));
      for (const model of selected) known.add(model);
      get('Models').replaceChildren();
      for (const model of [...known].sort()) {
        const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.value = model; check.checked = selected.has(model);
        const unknown = registered.length && !registered.includes(model); if (unknown) label.className = 'unknown-model';
        label.append(check, document.createTextNode(model + (unknown ? '（未登记）' : ''))); get('Models').append(label);
      }
      form.elements.scope.value = defaultScope || (note.common ? 'common' : selected.size ? 'models' : 'unresolved');
      get('Common').disabled = Boolean(note.inherited); productsInput.value = ''; get('CustomModels').hidden = registered.length > 0;
      get('Inheritance').textContent = note.inherited ? '当前位置受型号条件约束：' + (note.conditions || []).join(' ∩ ') + '；不能确认为所有型号通用。' : '';
      sync();
    }
    function read() {
      const scope = form.elements.scope.value, selected = Array.from(get('Models').querySelectorAll('input:checked'), node => node.value);
      if (!get('CustomModels').hidden) selected.push(...productsInput.value.trim().split(/\s+/).filter(Boolean));
      const products = scope === 'models' ? [...new Set(selected)] : [];
      if (scope === 'models' && !products.length) throw new Error('请选择至少一个型号，或选择通用／待确认');
      A.project.check(products); return { products: products.join(' '), common: scope === 'common' };
    }
    form.addEventListener('change', sync);
    return { draw, read };
  }
  root.DitaNoteScope = { createPicker };
})(window);
