'use strict';
(function (root) {
  const sax = typeof module !== 'undefined' ? require('./vendor/sax') : root.sax;
  function decode(value = '') { let out = ''; const parser = sax.parser(true); parser.ontext = text => { out += text; }; parser.write('<v>' + value + '</v>').close(); return out; }
  function conditions(node, ancestors = []) { return [...ancestors, node].map(parent => decode(parent.attrs.product).trim()).filter(Boolean); }
  function matches(conditions, model = '') { return !model || conditions.every(value => value.split(/\s+/).includes(model)); }
  function common(attrs) { return /(?:^|\s)applicability\(common\)(?:\s|$)/.test(decode(attrs.otherprops)); }
  function validateProject(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object' || value.schema !== 1 || !Array.isArray(value.models) || value.models.length > 200) throw new Error('项目配置格式无效');
    const models = value.models.map(model => {
      if (typeof model !== 'string' || !model || model.length > 80 || /[\s()<>"'&/\\\x00-\x1f]/.test(model)) throw new Error('型号须为不含空格、括号和路径符号的名称');
      return model;
    });
    if (new Set(models).size !== models.length) throw new Error('型号清单包含重复项');
    return { schema: 1, models };
  }
  function checkModels(values, project) {
    if (!project?.models?.length) return [];
    return [...new Set(values)].filter(value => !project.models.includes(value));
  }
  function relativeHref(from, target, fragment = '') {
    const base = from.split('/').slice(0, -1), parts = target.split('/');
    while (base.length && parts.length && base[0] === parts[0]) { base.shift(); parts.shift(); }
    return [...base.map(() => '..'), ...parts].map(encodeURIComponent).join('/') + (fragment ? '#' + fragment.split('/').map(encodeURIComponent).join('/') : '');
  }
  function createEvents(onError = error => console.error(error)) {
    const listeners = new Map();
    return { on(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); return () => listeners.get(name)?.delete(callback); },
      emit(name, value) { for (const callback of listeners.get(name) || []) { try { callback(value); } catch (error) { onError(error); } } } };
  }
  const api = { decode, conditions, matches, common, validateProject, checkModels, relativeHref, createEvents };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaManualCore = api;
})(typeof window === 'undefined' ? globalThis : window);
