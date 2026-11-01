'use strict';
(function (root) {
  function createPicker(A, prefix, formId, productId) {
    const get = suffix => document.getElementById(prefix + suffix), form = document.getElementById(formId), productsInput = document.getElementById(productId);
    let original = null;
    function sync() {
      const scope = form.elements.scope.value;
      get('ModelPicker').hidden = scope !== 'models';
      const selected = Array.from(get('Models').querySelectorAll('input:checked'), node => node.value);
      if (!get('CustomModels').hidden) selected.push(...productsInput.value.trim().split(/\s+/).filter(Boolean));
      const conditions = [...(original?.conditions || [])];
      // The source's own product condition is replaced; ancestor restrictions stay.
      if (original?.products?.length) conditions.pop();
      if (scope === 'models' && selected.length) conditions.push([...new Set(selected)].join(' '));
      const models = A.project.value.models;
      const effective = models.filter(model => conditions.every(condition => condition.split(/\s+/).includes(model)));
      const summary = get('ScopeSummary');
      summary.dataset.state = scope === 'models' && !selected.length || models.length && conditions.length && !effective.length ? 'warning' : 'normal';
      summary.textContent = scope === 'common' ? '所有型号通用。' : scope === 'models' && !selected.length ? '请选择适用型号。' :
        conditions.some(condition => /[()]/.test(condition)) ? '包含分组型号条件，请在交付检查中确认适用范围。' :
        conditions.length ? (models.length ? effective.length ? '当前清单中适用：' + effective.join('、') : '与上级型号条件没有交集，请调整选择。' : '需同时满足：' + conditions.join(' ∩ ')) + (scope === 'unresolved' ? '；本条仍待确认。' : '') : '适用范围待确认；所有型号交付时都会保留。';
    }
    function draw(note, defaultScope) {
      original = note;
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
    form.addEventListener('change', sync); productsInput.addEventListener('input', sync);
    return { draw, read };
  }
  root.DitaNoteScope = { createPicker };
})(window);
