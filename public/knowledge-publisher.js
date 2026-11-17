'use strict';
(function (root) {
  const cancelled = () => Object.assign(Error('已取消发布'), { name: 'AbortError' });
  // One worker owns a sealed publication. Large HTML/index/vector objects stay
  // there; the UI receives progress, preview HTML on demand, or a final Blob.
  function createPublisher({ createWorker = () => new root.Worker('/knowledge-publish-worker.js') } = {}) {
    let worker = null, pending = null, sequence = 0;
    function dispose(reason = cancelled()) {
      const old = worker, task = pending; worker = null; pending = null;
      task?.cleanup(); task?.reject(reason);
      if (!old) return;
      // Abort fetch first; terminate also interrupts synchronous ZIP/index work.
      const timer = setTimeout(() => old.terminate(), 100);
      old.onmessage = event => { if (event.data.type === 'cancelled') { clearTimeout(timer); old.terminate(); } };
      old.onerror = () => { clearTimeout(timer); old.terminate(); };
      try { old.postMessage({ type: 'cancel' }); } catch { clearTimeout(timer); old.terminate(); }
    }
    function ensureWorker() {
      if (worker) return worker;
      let next;
      try { next = createWorker(); } catch (cause) { throw Error('无法启动后台发布任务，请刷新页面后重试', { cause }); }
      worker = next;
      next.onmessage = ({ data }) => {
        if (worker !== next || !pending || pending.id !== data.id) return;
        if (data.type === 'progress') {
          try { pending.onProgress(data.value); } catch (cause) { dispose(cause); }
          return;
        }
        const task = pending; pending = null; task.cleanup();
        if (data.type === 'result') task.resolve({ ...data.value, metrics: data.metrics });
        else task.reject(Error(data.message || '后台发布响应无效，请重试'));
      };
      next.onerror = event => { event.preventDefault?.(); if (worker === next) dispose(Error('后台发布失败：' + (event.message || '请重新导出'))); };
      next.onmessageerror = () => { if (worker === next) dispose(Error('后台发布数据传输失败，请重新导出')); };
      return next;
    }
    function run(action, payload, { signal, onProgress = () => {} } = {}) {
      if (signal?.aborted) return Promise.reject(cancelled());
      if (pending) return Promise.reject(Error('发布任务正在运行'));
      return new Promise((resolve, reject) => {
        let target;
        try { target = ensureWorker(); } catch (cause) { reject(cause); return; }
        const id = ++sequence, cancel = () => dispose();
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        pending = { id, resolve, reject, onProgress, cleanup };
        signal?.addEventListener('abort', cancel, { once: true });
        try { target.postMessage({ id, action, payload }); }
        catch (cause) { dispose(cause); }
      });
    }
    return { prepare: (request, options) => run('prepare', request, options), preview: options => run('preview', null, options),
      download: (request, options) => run('download', request, options), dispose };
  }
  const api = { createPublisher };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgePublisher = api;
})(typeof window === 'undefined' ? globalThis : window);
