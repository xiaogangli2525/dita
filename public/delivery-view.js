'use strict';
(function (root) {
  // A view of the export operation. It never captures, validates or downloads
  // documents; export.js owns those operations and reports their outcome here.
  function createView() {
    const get = id => document.getElementById(id);
    let step = 'configure', ready = false, busy = false;
    const sections = { configure: 'deliveryConfigure', check: 'deliveryCheck', export: 'deliveryReady' };
    function show(next) {
      step = next === 'export' && !ready ? 'check' : next;
      for (const [name, id] of Object.entries(sections)) get(id).hidden = name !== step;
      document.querySelectorAll('[data-delivery-step]').forEach(button => {
        button.disabled = busy || (button.dataset.deliveryStep === 'export' && !ready);
        if (button.dataset.deliveryStep === step) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
    }
    document.querySelectorAll('[data-delivery-step]').forEach(button => button.addEventListener('click', () => show(button.dataset.deliveryStep)));
    function invalidate() {
      ready = false;
      get('deliveryCheckStatus').textContent = '点击“发布前检查”，核对文档、图片和链接。';
      get('deliveryReadySummary').textContent = '';
      show('configure');
    }
    function pending() { busy = true; get('deliveryCheckStatus').textContent = '正在核对文档、图片和链接…'; show('check'); }
    function complete() {
      ready = true;
      const model = get('exportModel').selectedOptions[0]?.textContent || '全部型号';
      const format = get('exportFormat').selectedOptions[0]?.textContent || '';
      get('deliveryReadySummary').textContent = [model, format, get('exportVersion').value.trim(), get('exportFilter')?.value].filter(Boolean).join(' · ');
      show('export');
    }
    function failed() { ready = false; get('deliveryCheckStatus').textContent = '请处理下面的问题后重新检查。'; show('check'); }
    function settled() { busy = false; show(step); }
    return { invalidate, pending, complete, failed, settled };
  }
  root.DitaDeliveryView = { createView };
})(window);
