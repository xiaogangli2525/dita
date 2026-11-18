// @ts-check
'use strict';
(function (root) {
  /** Parse a decoded DITA condition attribute into groups of distinct values.
   * @param {string} attribute
   * @param {string} value
   * @returns {Map<string, Set<string>>} */
  function parseConditionGroups(attribute, value) {
    const groups = new Map();
    const token = /\s*([^\s()]+)(?:\(([^()]*)\))?(?=\s|$)/gy;
    const source = value.trim();
    while (token.lastIndex < source.length) {
      const match = token.exec(source);
      if (!match) throw new Error('条件属性的分组语法无效：' + value);
      const [ , name, contents] = match;
      const group = contents === undefined ? attribute : name;
      const values = contents === undefined ? [name] : contents.trim().split(/\s+/).filter(Boolean);
      if (!values.length) continue;
      if (!groups.has(group)) groups.set(group, new Set());
      for (const item of values) groups.get(group)?.add(item);
    }
    return groups;
  }

  const api = { parseConditionGroups };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaConditionGroups = api;
})(typeof window === 'undefined' ? globalThis : window);
