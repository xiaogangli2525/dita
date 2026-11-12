// @ts-check
'use strict';
(function (root) {
  const snapshots = typeof module !== 'undefined' ? require('./snapshot-data') : root.DitaSnapshotData;
  /** Rehydrate only immutable source data; no live editor state or IO enters this adapter.
   * @param {import('./knowledge-contracts').KnowledgeBundle} bundle */
  function hydrate(bundle) {
    if (bundle.schema !== 1 || !bundle.snapshot || !bundle.receipt || bundle.snapshot.root !== bundle.receipt.repositoryRoot || !/^[a-f0-9]{40,64}$/.test(bundle.receipt.commit)) throw Error('来源快照格式无效，请重新核对');
    if (!Array.isArray(bundle.texts) || !Array.isArray(bundle.assets) || bundle.texts.length > 256 || bundle.assets.length > 256 || !Array.isArray(bundle.snapshot.files)) throw Error('来源快照文件清单无效');
    const texts = new Map(bundle.texts), assets = new Map(bundle.assets);
    if (texts.size !== bundle.texts.length || assets.size !== bundle.assets.length || [...texts, ...assets].some(([name, text]) => typeof name !== 'string' || typeof text !== 'string')) throw Error('来源快照文件重复或内容无效');
    if (texts.get(bundle.snapshot.path) !== bundle.snapshot.content || bundle.snapshot.files.some(([name, file]) => texts.get(name) !== file.current)) throw Error('来源正文与文件清单不一致');
    const snapshot = snapshots.createSnapshot({ ...bundle.snapshot, files: new Map(bundle.snapshot.files), buffers: new Map() });
    return { snapshot, texts, assets };
  }
  const api = { hydrate };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSourceData = api;
})(typeof window === 'undefined' ? globalThis : window);
