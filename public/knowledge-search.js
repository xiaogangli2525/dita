// @ts-check
'use strict';
(function (root) {
  const retrieval = typeof module !== 'undefined' ? require('./knowledge-retrieval') : root.DitaKnowledgeRetrieval;
  /** @param {ReturnType<typeof retrieval.createSdkSearch>} [sdk] */
  function createSearchEngine(sdk = retrieval.createSdkSearch()) {
    const options = {
      dictionary: [
        '数据拨号', 'PDP', 'PDP上下文', 'APN', '自动联网', 'GPIO', '引脚分配', '引脚资源', '外设资源', '内存资源',
        'WebUI', 'WebServer', '前端定制开发', '后端定制开发', '前后端交互', '编译环境',
        '固件下载', '下载固件', 'LOG抓取', '死机现场查看', '驻网时间', '用户入口函数',
        'cm_modem_call', 'cm_modem_set_pdp_context', 'cm_mem_get_heap_stats',
        '客户端', '客户端实例', '实例', '报头', '请求头', '请求体', '请求', '响应', '缓存模式', '缓存',
        '证书', 'SSL', '错误码', '型号', '支持', '回车符', '结尾', 'URC', '连接失败', '超时',
        'HTTP实例', 'HTTP命令', 'HTTP/HTTPS协议', 'AT命令', 'AT指令', 'GET', 'POST', 'PUT',
        'content', 'header', '下载', '大数据', '配置参数', '写入'
      ],
      synonyms: {
        '模块上不了网': '数据拨号', '为什么不能上网': '数据拨号', '无法上网': '数据拨号', 'PDP数据连接': 'PDP上下文', 'GPIO引脚': '引脚资源',
        '上不了网': '数据拨号', '不能上网': '数据拨号',
        '怎么烧录固件': '下载固件', '烧录固件': '下载固件', '怎么刷机': '下载固件',
        '固件下栽': '下载固件', '编译环景': '编译环境', '引脚分佩': '引脚分配',
        '抓取日志': 'LOG抓取', '抓日志': 'LOG抓取',
        '死机现场怎么查': '死机现场查看', '死机后怎么看现场': '死机现场查看',
        '查看剩余内存': '内存资源', '可用内存': '内存资源',
        '网页怎么定制': '前端定制开发', '怎么定制网页': '前端定制开发',
        '后台服务在哪': '后端WebServer', '前后端怎么通信': '前后端交互',
        '网络注册要多久': '驻网时间',
        '请求头': '报头 header', 'HTTP头': '报头 header', '请求头内容': '报头设置',
        '连不上': '连接失败', '连接不上': '连接失败', '无法连接': '连接失败', '服务器不可达': '连接失败',
        'HTTP客户端实例': 'HTTP实例', 'HTTP客户端': 'HTTP实例', '删除客户端': '删除HTTP实例', '客户端': '实例', '客户端': '实例',
        'AT指令': 'AT命令', '指令': '命令', '最后': '结尾', '结尾': '回车符', '返回': '响应',
        'HTTP返回': '错误码', 'HTTP相关命令': 'HTTP/HTTPS协议AT命令', '相关命令': 'HTTP/HTTPS协议AT命令', '哪些模组型号支持': '适用型号',
        '哪些模组型号': '适用型号', '模组型号': '适用型号',
        'HTTP连接参数配置': '客户端实例通用配置参数', '连接参数配置': '配置参数',
        'HTTPS证书': 'SSL证书', '证书写入': 'SSL证书写入',
        '下载大文件': '获取大数据', '大文件': '大数据', '发起GET请求': '发送HTTP请求', 'GET请求': 'HTTP请求',
        '请求体': 'content', '请求正文': 'content', 'POST数据': 'content',
        '发起HTTP请求': '发送HTTP请求', '执行GET请求': 'HTTP示例',
        '删除客户端': '删除HTTP实例', '关闭HTTP实例': '终止HTTP传输',
        '停止传输': '终止HTTP传输', '结束传输': '终止HTTP传输',
        '文件保存到模组': 'HTTP下载文件', '下载到本地': 'HTTP下载文件',
        '服务器主动上报': 'URC信息上报', '异步上报': 'URC信息上报',
        'HTTP状态码': '错误码', 'HTTP错误代码': '错误码',
        '证书写入': 'SSL证书', 'HTTPS证书': 'SSL证书',
        '大文件': '缓存模式', '缓存响应': '缓存模式'
      }
    };
    /** @type {WeakMap<object, {records: readonly import('./knowledge-contracts').SearchRecord[], api: import('./knowledge-retrieval').SdkEngine}>} */
    const cached = new WeakMap();
    /** @param {string} text @param {boolean} [_question] */
    function tokens(text, _question = false) {
      return [...new Set(sdk.normalize(text).match(/at\+[a-z0-9_]+|[a-z0-9_]+|[\u3400-\u9fff]{1,2}/g) || [])];
    }
    /** @param {import('./knowledge-contracts').SearchRecord} record */
    function metadata(record) {
      const symbols = [...new Set([...(record.symbols || []), ...(record.title + ' ' + record.text).match(/AT\+[A-Z0-9_]+|\b[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]*/gi) || []])];
      const definedSymbols = record.definedSymbols || symbols.filter(symbol => {
        const title = sdk.normalize(record.title), name = sdk.normalize(symbol);
        return (title === name || title.startsWith(name + ' ')) && !/示例|调用|example/i.test(title);
      });
      return { symbols, definedSymbols };
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records */
    function rows(records) {
      return records.map((record, index) => {
        const aliases = [...(record.aliases || [])], content = record.title + ' ' + record.text;
        if (/\btimeout\b/i.test(content)) aliases.push('超时'); if (content.includes('超时')) aliases.push('timeout');
        if (/\bcertificate\b/i.test(content)) aliases.push('证书'); if (content.includes('证书')) aliases.push('certificate');
        return { id: String(index), manualId: record.manualId, url: record.manualId + '#' + (record.anchor || index), title: record.title, text: record.text,
        docTitle: record.manualTitle || '', module: record.module || record.manualTitle || '', mode: record.mode || 'other',
        aliases, kind: record.kind || 'guide', ...metadata(record) }; });
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @returns {import('./knowledge-contracts').SearchIndex} */
    function build(records) { return { schema: 2, compiled: sdk.compile(rows(records), options) }; }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index */
    function engine(records, index) {
      let value = cached.get(index);
      if (!value || value.records !== records) { value = { records, api: sdk.create(rows(records), { ...options, compiled: index.compiled }) }; cached.set(index, value); }
      return value.api;
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index
     * @param {string} query @param {string} [manualId] @param {number} [limit] @param {{mode?:string,module?:string}} [filters] */
    function search(records, index, query, manualId = '', limit = 40, filters = {}) {
      const hits = engine(records, index).search(query, { ...filters, manualId, limit });
      return hits.map(hit => ({ position: Number(hit.record.id), score: hit.score, complete: true, reason: hit.reason, matchedTerms: hit.matchedTerms }))
        .filter(hit => !manualId || records[hit.position]?.manualId === manualId).slice(0, Math.max(0, limit));
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index @param {string} query @param {{manualId?:string,mode?:string,module?:string}} [filters] */
    function suggest(records, index, query, filters = {}) { return engine(records, index).suggest(query, 6, filters); }
    /** @param {string} text @param {string} query @param {number} [length] */
    function excerpt(text, query, length = 190) {
      const value = String(text || '').replace(/\s+/g, ' ').trim(), normalized = sdk.normalize(value);
      const positions = tokens(query).map(word => normalized.indexOf(word)).filter(position => position >= 0);
      const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 45);
      return (start ? '…' : '') + value.slice(start, start + length) + (value.length > start + length ? '…' : '');
    }
    return { tokens, metadata, build, search, suggest, excerpt };
  }
  function runtimeSource() { return '(' + createSearchEngine.toString() + ')((' + retrieval.createSdkSearch.toString() + ')())'; }
  const api = { createSearchEngine, runtimeSource };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSearch = api;
})(typeof window === 'undefined' ? globalThis : window);
