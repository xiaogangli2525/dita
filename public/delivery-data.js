// @ts-check
'use strict';
(function (root) {
  /** Build an auditable record from the exact compiled output, without UI or storage.
   * @param {import('./data-contracts').DeliveryRequest} request
   * @param {(value:string|Blob)=>Promise<string>} sha256
   * @returns {Promise<import('./data-contracts').DeliveryRecord>} */
  async function createRecord({ snapshot, source, data, model, format, version, filename, prefixes, unsavedPaths }, sha256) {
    if (!['html', 'md', 'pdf', 'docx'].includes(format) || !filename) throw TypeError('交付格式或文件名无效');
    /** @type {Map<string,string>} */
    const documents = new Map([[snapshot.path, snapshot.content], ...Array.from(snapshot.files, /** @returns {[string,string]} */ ([path, file]) => [path, file.current])]);
    if (snapshot.filter) documents.set(snapshot.filter.path, snapshot.filter.current);
    if (typeof snapshot.noteRules?.expectedContent === 'string') documents.set('.dita-note-rules.json', snapshot.noteRules.expectedContent);
    return { schema: 1, createdAt: new Date().toISOString(), state: 'download-initiated', manualPath: snapshot.path,
      model, format, version, filename, source: { ...source }, capturedAt: snapshot.capturedAt,
      filterPath: snapshot.filter?.path || '', modelNotePrefixPolicy: model && prefixes ? 'explicit-prefix-v1' : 'confirmed-rules-only',
      unsavedPaths: [...unsavedPaths], report: { ...data.report },
      documents: await Promise.all(Array.from(documents, async ([path, content]) => ({ path, sha256: await sha256(content) }))),
      projectSha256: await sha256(JSON.stringify(snapshot.project)),
      noteRulesSha256: snapshot.noteRules ? await sha256(JSON.stringify(snapshot.noteRules.config)) : null,
      template: data.template ? { ...data.template, fields: { ...data.template.fields } } : null,
      outputSha256: await sha256(data.output) };
  }
  const api = { createRecord };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDeliveryData = api;
})(typeof window === 'undefined' ? globalThis : window);
