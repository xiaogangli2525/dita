'use strict';
// SDK domain vocabulary is kept outside the retrieval algorithm.
(function (root) {
  const profile = {
      dictionary: [
        '数据拨号', 'PDP', 'PDP上下文', 'APN', '自动联网', 'GPIO', '引脚分配', '引脚资源', '外设资源', '内存资源',
        '网页', '外观', '样式', '界面', '主题', '皮肤', '修改', '上报', '事件', '通知',
        'WebUI', 'WebServer', '前端定制开发', '后端定制开发', '前后端交互', '编译环境',
        '固件下载', '下载固件', 'LOG抓取', '死机现场查看', '驻网时间', '用户入口函数',
        'cm_modem_call', 'cm_modem_set_pdp_context', 'cm_mem_get_heap_stats',
        '客户端', '客户端实例', '实例', '报头', '请求头', '请求体', '请求', '响应', '缓存模式', '缓存',
        '证书', 'SSL', '错误码', '型号', '支持', '回车符', '结尾', 'URC', '连接失败', '超时',
        'HTTP实例', 'HTTP命令', 'HTTP/HTTPS协议', 'AT命令', 'AT指令', 'GET', 'POST', 'PUT',
        'content', 'header', '下载', '大数据', '配置参数', '写入'
      ],
      technicalAliases: { '串行口': 'uart', '串口': 'uart' },
      stopWords: ['我要', '我想', '帮我', '请帮我'],
      synonyms: {
        '模块上不了网': '数据拨号', '为什么不能上网': '数据拨号', '无法上网': '数据拨号', 'PDP数据连接': 'PDP上下文',
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
        'HTTP客户端实例': 'HTTP实例', 'HTTP客户端': 'HTTP实例', '删除客户端': '删除HTTP实例', '客户端': '实例',
        'AT指令': 'AT命令', '指令': '命令', '最后': '结尾', '结尾': '回车符', '返回': '响应',
        'HTTP返回': '错误码', 'HTTP相关命令': 'HTTP/HTTPS协议AT命令', '相关命令': 'HTTP/HTTPS协议AT命令', '哪些模组型号支持': '适用型号',
        '哪些模组型号': '适用型号', '模组型号': '适用型号',
        'HTTP连接参数配置': '客户端实例通用配置参数', '连接参数配置': '配置参数',
        'HTTPS证书': 'SSL证书', '证书写入': 'SSL证书写入',
        '下载大文件': '获取大数据', '大文件': '大数据', '发起GET请求': '发送HTTP请求', 'GET请求': 'HTTP请求',
        '请求体': 'content', '请求正文': 'content', 'POST数据': 'content',
        '给POST请求添加请求内容': 'HTTP content数据', 'HTTPS证书怎么写入': 'SSL证书写入', '请求内容': 'HTTP content数据',
        '发起HTTP请求': '发送HTTP请求', '执行GET请求': 'HTTP示例',
        '停止传输': '终止HTTP传输', '结束传输': '终止HTTP传输',
        '文件保存到模组': 'HTTP下载文件', '下载到本地': 'HTTP下载文件',
        '服务器主动上报': 'URC信息上报', '异步上报': 'URC信息上报',
        'HTTP状态码': '错误码', 'HTTP错误代码': '错误码',
        '缓存响应': '缓存模式'
      },
    aliasRules: [
      { field: 'content', pattern: '\\btimeout\\b', flags: 'i', aliases: ['超时'] },
      { field: 'content', pattern: '超时', aliases: ['timeout'] },
      { field: 'content', pattern: '\\bcertificate\\b', flags: 'i', aliases: ['证书'] },
      { field: 'content', pattern: '证书', aliases: ['certificate'] },
      { field: 'title', pattern: '引脚分配', aliases: ['GPIO 引脚 分配'] },
      { field: 'title', pattern: '引脚资源', aliases: ['GPIO 引脚 资源', 'GPIO引脚'] },
      { field: 'title', pattern: '前端.*定制', aliases: ['网页 外观 样式 界面 主题 皮肤 修改'] },
      { field: 'title', pattern: 'URC.*上报', flags: 'i', aliases: ['主动上报 事件 通知 异步上报'] },
      { field: 'title', pattern: '\\bAT\\+MHTTPDEL\\b', flags: 'i', aliases: ['关闭HTTP实例', '释放HTTP实例'] }
    ]
  };
  if (typeof module !== 'undefined') module.exports = profile; else root.DitaKnowledgeSearchProfile = profile;
})(typeof window === 'undefined' ? globalThis : window);
