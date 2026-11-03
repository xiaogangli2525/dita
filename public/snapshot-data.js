// @ts-check
'use strict';
(function (root) {
  const store = typeof module !== 'undefined' ? require('./document-store') : root.DitaDocumentStore;
  /** A frozen Map alone still permits set/delete. Keep the actual collection private.
   * @template K,V
   * @param {Iterable<readonly [K,V]>} entries
   * @returns {ReadonlyMap<K,V>} */
  function readonlyMap(entries) {
    const map = new Map(entries);
    /** @type {ReadonlyMap<K,V>} */
    const view = Object.freeze({ get: /** @param {K} key */ key => map.get(key), has: /** @param {K} key */ key => map.has(key),
      get size() { return map.size; }, keys: () => map.keys(), values: () => map.values(), entries: () => map.entries(),
      /** @param {(value:V,key:K,map:ReadonlyMap<K,V>)=>void} callback
       * @param {unknown} [thisArg] */
      forEach(callback, thisArg) { map.forEach((value, key) => callback.call(thisArg, value, key, view)); },
      [Symbol.iterator]: () => map[Symbol.iterator]() });
    return view;
  }
  /** Only plain snapshot data enters here; no live DOM, buffers or history.
   * @template T
   * @param {T} value
   * @returns {T} */
  function detached(value) {
    const copy = structuredClone(value);
    /** @param {unknown} item */
    function freeze(item) {
      if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    }
    freeze(copy); return copy;
  }
  /** @param {import('./data-contracts').ManualSnapshot} input
   * @returns {import('./data-contracts').ManualSnapshot} */
  function createSnapshot(input) {
    if (!input.workspace || !input.path || typeof input.content !== 'string') throw TypeError('手册快照标识无效');
    return Object.freeze({ ...input, map: detached(input.map), project: detached(input.project),
      filter: detached(input.filter), noteRules: detached(input.noteRules),
      files: readonlyMap(Array.from(input.files, ([path, file]) => [path, Object.freeze({ path, current: file.current })])),
      buffers: readonlyMap(Array.from(input.buffers, ([path, file]) => [path, store.snapshotDocument(file)])) });
  }
  const api = { readonlyMap, createSnapshot };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaSnapshotData = api;
})(typeof window === 'undefined' ? globalThis : window);
