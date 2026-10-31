'use strict';
(function (root) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const definitions = {
    overview: ['功能概述', 'topic', '<section><title>功能说明</title><p>说明功能用途、使用条件和限制。</p></section><section><title>使用流程</title><p>在此说明操作流程。</p></section>'],
    command: ['AT 命令说明', 'reference', '<section><title>命令说明</title><p>说明命令用途。</p><codeblock>AT+COMMAND</codeblock></section><section><title>参数</title><table><tgroup cols="2"><thead><row><entry>参数</entry><entry>说明</entry></row></thead><tbody><row><entry>参数名</entry><entry>取值与默认值</entry></row></tbody></tgroup></table></section><section><title>响应与示例</title><codeblock>OK</codeblock></section>'],
    parameters: ['参数表', 'topic', '<table><title>参数说明</title><tgroup cols="3"><thead><row><entry>参数</entry><entry>取值范围</entry><entry>默认值与说明</entry></row></thead><tbody><row><entry>参数名</entry><entry>取值</entry><entry>说明</entry></row></tbody></tgroup></table>'],
    example: ['操作示例', 'task', '<context><p>说明示例目标和前置条件。</p></context><steps><step><cmd>执行操作。</cmd><stepxmp><codeblock>AT+COMMAND</codeblock></stepxmp></step></steps><result><p>说明预期结果。</p></result>'],
    differences: ['型号差异', 'topic', '<p>在具体功能或参数后插入注脚，记录型号差异；通过“新增注脚”选择适用型号。</p>'],
    topic: ['通用主题', 'topic', '<p>在此输入内容。</p>'], concept: ['概念说明', 'concept', '<p>在此输入内容。</p>'],
    task: ['任务步骤', 'task', '<steps><step><cmd>在此输入步骤。</cmd></step></steps>'], reference: ['参考信息', 'reference', '<section><title>参考内容</title><p>在此输入内容。</p></section>'], ditamap: ['功能手册目录', 'map', '']
  };
  function create(kind, title, path) {
    const definition = definitions[kind]; if (!definition) throw new Error('请选择有效的文档模板');
    const [, tag, body] = definition, stem = path.split('/').pop().replace(/\.[^.]+$/, '');
    let id = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'new-topic'; if (/^\d/.test(id)) id = 'topic-' + id;
    const publicName = tag[0].toUpperCase() + tag.slice(1), bodyTag = { topic: 'body', concept: 'conbody', task: 'taskbody', reference: 'refbody' }[tag];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE ${tag} PUBLIC "-//OASIS//DTD DITA ${publicName}//EN" "${tag}.dtd">\n<${tag} id="${id}">\n<title>${escape(title)}</title>\n${tag === 'map' ? '' : `<${bodyTag}>${body}</${bodyTag}>\n`}</${tag}>\n`;
  }
  const api = { definitions, create };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDocumentTemplates = api;
})(typeof window === 'undefined' ? globalThis : window);
