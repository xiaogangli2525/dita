'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const { decode } = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const BLOCKS = new Set('title shortdesc p cmd codeblock pre note fn entry stentry li dd dt'.split(' '));
  const LIMITS = Object.freeze({ source: 400000, text: 16000, instruction: 6000, edits: 80 });
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  const endOf = node => node.close?.end ?? node.end;
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Source ranges, never a serialize/replace of the whole XML tree. Attribute,
  // reference, ID, PI and other-model markup cannot be returned as edit targets.
  function inspect(source) {
    if (typeof source !== 'string' || source.length > LIMITS.source) fail('文档过大，请先拆分到单个 Topic 后使用 AI');
    const tree = xml.inspectSource(source), blocks = [];
    if (!['topic', 'concept', 'task', 'reference'].includes(tree.name)) fail('AI 修订当前仅支持 Topic 正文，请在手册中选择章节');
    function visit(node, xmlPath, conditions = [], protectedContent = false) {
      if (node.kind !== 'element') return;
      protectedContent ||= ['foreign', 'unknown', 'prolog'].includes(node.name) || Boolean(node.attrs.conref || node.attrs.conkeyref || node.attrs.keyref);
      conditions = [...conditions, ...['product', 'platform', 'audience', 'otherprops'].filter(key => node.attrs[key]).map(key => key + '=' + decode(node.attrs[key]))];
      if (!protectedContent && BLOCKS.has(node.name)) {
        const hasOwnText = node.children.some(child => child.kind === 'text' && source.slice(child.start, child.end).trim() || child.kind === 'cdata' || child.kind === 'element' && !BLOCKS.has(child.name));
        if (hasOwnText) blocks.push({ start: node.start, end: endOf(node), xmlPath, kind: node.name, conditions, node });
      }
      node.children.filter(child => child.kind === 'element').forEach((child, index) => visit(child, xmlPath ? xmlPath + '/' + index : String(index), conditions, protectedContent));
    }
    visit(tree, '');
    return blocks;
  }
  function target(source, start, end, blocks = inspect(source)) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) fail('请选择有效的正文范围');
    const block = blocks.filter(item => item.start <= start && item.end >= end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (!block) fail('此选区不支持 AI 修订，请选择同一段落、注脚或表格单元格');
    const parts = [];
    function visit(node) {
      if (node.start >= end || endOf(node) <= start) return;
      if (node.kind === 'pi' && /<\?oxy_/.test(source.slice(node.start, node.end))) fail('选区含未处理的 Oxygen 修订，请先审核后再使用 AI');
      if (node.kind === 'element') {
        if (node.attrs.conref || node.attrs.conkeyref || node.attrs.keyref || ['foreign', 'unknown'].includes(node.name)) fail('选区含复用引用或扩展内容，请先定位到定义来源');
        node.children.forEach(visit);
      } else if (node.kind === 'text' || node.kind === 'cdata') {
        const begin = node.start + (node.kind === 'cdata' ? 9 : 0), finish = node.end - (node.kind === 'cdata' ? 3 : 0);
        const a = Math.max(begin, start), b = Math.min(finish, end);
        if (b <= a) return;
        if (node.kind === 'text') {
          for (const match of source.slice(begin, finish).matchAll(/&[^;\s]+;/g)) {
            const x = begin + match.index, y = x + match[0].length;
            if (a > x && a < y || b > x && b < y) fail('选区截断了 XML 实体，请重新选择完整文字');
          }
        }
        const text = node.kind === 'cdata' ? source.slice(a, b) : decode(source.slice(a, b));
        if (text.trim()) parts.push(Object.freeze({ id: 't' + parts.length, start: a, end: b, text, kind: node.kind }));
      }
    }
    visit(block.node);
    const text = parts.map(part => part.text).join('');
    if (!parts.length || text.length > LIMITS.text || parts.length > LIMITS.edits) fail('选区为空或过大，请缩小到一段说明或一个参数');
    return Object.freeze({ source, start, end, xmlPath: block.xmlPath, kind: block.kind, conditions: Object.freeze(block.conditions), text, parts: Object.freeze(parts) });
  }
  function candidates(source, query = '') {
    const words = [...new Set((query.toLowerCase().match(/[a-z0-9_+.-]{2,}|[\u3400-\u9fff]{2,}/g) || []).flatMap(word => /^[\u3400-\u9fff]+$/.test(word) && word.length > 2 ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))] : [word]))];
    const result = [];
    const blocks = inspect(source);
    for (const block of blocks) {
      try {
        const scope = target(source, block.start, block.end, blocks), lower = scope.text.toLowerCase();
        const score = words.reduce((sum, word) => sum + (lower.includes(word) ? word.length : 0), 0);
        if (!query.trim() || score) result.push({ start: block.start, end: block.end, xmlPath: block.xmlPath, text: scope.text, kind: block.kind, score });
      } catch { /* Ineligible blocks (references/revisions/oversize) remain untouched. */ }
    }
    return result.sort((a, b) => b.score - a.score || a.start - b.start);
  }
  function applyResult(scope, result) {
    if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.summary !== 'string' || result.summary.length > 4000 || !Array.isArray(result.questions) || result.questions.length > 12 || result.questions.some(q => typeof q !== 'string' || q.length > 1500) || !Array.isArray(result.edits) || result.edits.length > LIMITS.edits) fail('模型返回格式不符合修订约定，请重试');
    if (result.blockedReason !== undefined && (typeof result.blockedReason !== 'string' || result.blockedReason.length > 2000)) fail('模型返回的范围说明无效，请重试');
    const seen = new Set(), changes = [];
    for (const edit of result.edits) {
      const part = scope.parts.find(item => item.id === edit?.id);
      if (!part || seen.has(edit.id) || edit.before !== part.text || typeof edit.after !== 'string' || edit.after.length > LIMITS.text) fail('模型返回了越界、重复或原文不匹配的修改，已拒绝');
      seen.add(edit.id);
      if (part.kind === 'cdata' && edit.after.includes(']]>')) fail('模型修改包含非法 CDATA 结束标记');
      if (edit.after !== edit.before) changes.push({ ...part, after: edit.after });
    }
    let content = scope.source;
    for (const change of [...changes].sort((a, b) => b.start - a.start)) {
      content = content.slice(0, change.start) + (change.kind === 'cdata' ? change.after : escape(change.after)) + content.slice(change.end);
    }
    if (content.length > LIMITS.source) fail('模型修改超出文档大小限制');
    xml.validateXml(content);
    return { content, summary: result.summary, questions: [...result.questions], blockedReason: result.blockedReason || '', changes };
  }
  const api = { LIMITS, inspect, target, candidates, applyResult };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAiEditCore = api;
})(typeof window === 'undefined' ? globalThis : window);
