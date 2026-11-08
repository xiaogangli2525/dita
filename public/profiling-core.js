'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const attributes = new Set(['audience', 'platform', 'product', 'props', 'otherprops', 'deliveryTarget']);
  function compile(source) {
    const tree = xml.inspectSource(source), rules = new Map(), decisions = new WeakMap();
    if (tree.name !== 'val') throw new Error('DITAVAL 根元素须为 val');
    for (const node of tree.children.filter(n => n.kind === 'element')) {
      if (node.name !== 'prop' || node.children.some(n => n.kind === 'element')) throw new Error('DITAVAL 暂仅支持 prop 的 include、exclude、passthrough 规则，不支持标记样式或 revprop');
      const action = domain.decode(node.attrs.action), att = domain.decode(node.attrs.att), value = domain.decode(node.attrs.val);
      if (!['include', 'exclude', 'passthrough'].includes(action)) throw new Error('DITAVAL 不支持的 action：' + action);
      if (att && !attributes.has(att)) throw new Error('DITAVAL 不支持的条件属性：' + att);
      if ((!att && value) || /[\s()]/.test(value)) throw new Error('DITAVAL 的 val 须为单个值，且须指定 att');
      const key = att + '\n' + value;
      if (rules.has(key)) throw new Error('DITAVAL 包含重复规则：' + (att || '默认') + (value ? '=' + value : ''));
      rules.set(key, action);
    }
    function groups(value) {
      const found = [], plain = [];
      let rest = value;
      while (rest.trim()) {
        const match = /^\s*([^\s()]+)(?:\(([^()]*)\))?/.exec(rest);
        if (!match) throw new Error('条件属性的分组语法无效：' + value);
        if (match[2] === undefined) plain.push(match[1]);
        else found.push({ name: match[1], values: match[2].trim().split(/\s+/).filter(Boolean) });
        rest = rest.slice(match[0].length);
      }
      if (plain.length) found.push({ name: '', values: plain });
      return found;
    }
    function excluded(att, group, value) {
      const keys = [group && group + '\n' + value, att + '\n' + value, group && att + '\n' + group, att + '\n', '\n'].filter(Boolean);
      return keys.map(key => rules.get(key)).find(Boolean) === 'exclude';
    }
    function keep(node) {
      if (decisions.has(node)) return decisions.get(node);
      const included = [...attributes].every(att => {
        if (!node.attrs[att]) return true;
        const value = domain.decode(node.attrs[att]).trim();
        return !value || groups(value).every(group => !group.values.length || group.values.some(value => !excluded(att, group.name, value)));
      });
      decisions.set(node, included); return included;
    }
    // Maps can be filtered before resolving paths. Topic filtering is applied
    // by publication-core after expansion, keeping original note provenance.
    function filterSource(source) {
      const tree = xml.inspectSource(source), ranges = [];
      if (!keep(tree)) return null;
      function visit(node) {
        if (!keep(node)) { ranges.push([node.start, node.close?.end ?? node.end]); return; }
        node.children.filter(n => n.kind === 'element').forEach(visit);
      }
      visit(tree);
      for (const [start, end] of ranges.reverse()) source = source.slice(0, start) + source.slice(end);
      return source;
    }
    const names = { product:'产品标记', audience:'读者', platform:'平台', props:'条件', otherprops:'其他条件', deliveryTarget:'发布目标' };
    const actions = { include:'保留', exclude:'排除', passthrough:'正常保留' };
    const summary = [...rules].map(([key, action]) => {
      const [att,value] = key.split('\n');
      return actions[action] + (att ? names[att] : '所有条件') + (value ? value==='tbd'?'为“待定（tbd）”的内容':'为“'+value+'”的内容' : '的默认内容');
    }).join('；') || '保留全部标记内容';
    return { keep, filterSource, summary };
  }
  const api = { compile };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaProfiling = api;
})(typeof window === 'undefined' ? globalThis : window);
