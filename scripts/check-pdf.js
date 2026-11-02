'use strict';
const { createPdf } = require('../lib/pdf-export');
createPdf('<!doctype html><meta charset="utf-8"><p>中文用户手册 PDF 环境检查</p>').then(() => {
  console.log('PDF 组件及中文字体检查通过。');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
