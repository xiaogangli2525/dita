'use strict';
importScripts('../vendor/fflate.js', 'knowledge-retrieval.js', 'knowledge-search-profile.js', 'knowledge-search.js',
  'knowledge-structure.js', 'knowledge-semantic.js', 'knowledge-reader.js', 'knowledge-limits.js',
  'knowledge-zip.js', 'knowledge-package.js', '../workspace/workspace-client.js', 'knowledge-index.js');
let prepared, activeId = null, controller, phases = [], phaseStart = 0, stage = '';
function progress(value) {
  const now = performance.now();
  if (stage !== value.stage) {
    if (stage) phases.push({ stage, milliseconds: now - phaseStart });
    stage = value.stage; phaseStart = now;
  }
  self.postMessage({ id: activeId, type: 'progress', value });
}
function metrics() {
  return [...phases, ...(stage ? [{ stage, milliseconds: performance.now() - phaseStart }] : [])];
}
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    controller?.abort(); prepared = null; self.postMessage({ type: 'cancelled' }); return;
  }
  if (activeId !== null) { self.postMessage({ id: data.id, type: 'error', message: '发布任务正在运行' }); return; }
  activeId = data.id; controller = new AbortController(); phases = []; stage = '';
  try {
    let value;
    if (data.action === 'prepare') {
      prepared = null;
      prepared = self.DitaKnowledgePackage.preparePackage(data.payload, progress, { takeOwnership: true });
      value = { ...prepared.measure(), title: prepared.book.title, model: prepared.book.model, sdkVersion: prepared.book.sdkVersion,
        manuals: prepared.manuals.length, chapters: prepared.manuals.reduce((sum, manual) => sum + manual.entries.length, 0) };
    } else {
      if (!prepared) throw Error('发布内容已失效，请重新预览或导出');
      if (data.action === 'preview') value = { html: prepared.html, ...prepared.measure() };
      else if (data.action === 'download') {
        prepared.measure();
        let generated;
        const compact = Boolean(data.payload.semantic && data.payload.compact);
        if (data.payload.semantic) {
          self.DitaWorkspaceClient.adopt(data.payload.token);
          const options = { api: self.DitaWorkspaceClient, manuals: prepared.manuals, model: prepared.book.model, compact, archiveOverhead: prepared.archiveOverhead(compact),
            force: !!data.payload.force, signal: controller.signal };
          progress({ stage: 'estimate' });
          generated = await self.DitaKnowledgeIndex.publish({ ...options, onEstimate: estimate => prepared.measure(estimate), onProgress: progress });
        }
        if (controller.signal.aborted) throw Object.assign(Error('已取消发布'), { name: 'AbortError' });
        const output = prepared.build(generated?.index, { compact });
        value = { zip: output.zip, filename: output.filename, manifest: output.manifest,
          ...(generated ? { stats: generated.stats, warnings: generated.warnings } : {}) };
      } else throw Error('不支持的发布操作');
    }
    if (!controller.signal.aborted) self.postMessage({ id: data.id, type: 'result', value, metrics: metrics() });
  } catch (cause) {
    if (cause.name !== 'AbortError') self.postMessage({ id: data.id, type: 'error', message: cause.message });
  } finally { activeId = null; controller = null; }
};
