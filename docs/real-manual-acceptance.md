# 真实 HTTP 手册交付验收

本轮以 master `e5512fd` 为基线，验证编辑、审阅、保存和按型号交付的完整流程，并修复验收发现的 Word 长标题封面问题。源库是用户提供的 `examples/http_httpsusermanual`，不是演示 MQTT 文档。

## 输入与原文保护

- 主入口：`http_httpsusermanual.ditamap`，依赖闭包共 29 个文件，其中 25 个 DITA Topic。
- 验收在临时 Git 仓库副本中运行，原始库保持逐文件字节一致。
- 只在副本中将 HTTPS 示例的“SSL相应参数设置”改为“SSL相关参数设置”；命令、内联标记、其它说明和型号注脚均保持原样。
- 临时库在接受审阅前后都不自动写盘，只有点击保存后才改变文件；刷新后可以读到已保存的新内容。

## 已通过的流程

| 检查 | 结果 |
| --- | --- |
| 可视化编辑与源码回写 | 只改变指定文字，保留周围 XML、AT 命令及其它文件 |
| 正文修订 | 删除文字有删除线且与新增文字颜色不同；接受后标记消失 |
| 保存与刷新 | 保存前磁盘不变；保存后内容精确匹配预期，刷新恢复新内容 |
| HTML / PDF / Word | 两个型号均实际下载，保留已接受的修改和 14 种 AT 命令 |
| 交付来源记录 | 文件 SHA256、源文档 SHA256、型号、条件文件、模板包哈希均核对一致 |
| 型号注脚 | ML307G 保留 25 条，ML307N 保留 20 条；保留每条完整说明，注脚型号前缀仅包含所选型号 |
| Markdown 边界 | 真实库中的合并单元格被明确拦截，给出源文件位置，不生成成功交付记录 |

型号注脚验收使用明确前缀筛选，并选择 `filters/filter_tbd.ditaval` 排除已标记的待定内容。正文适用型号总表及未标注条件的说明保留原文；本结果不表示系统能从任意正文语义中自动判断型号范围，也不替代研发确认参数正确性。

## 排版与本轮修复

内置企业模板和用户提供的企业模板副本分别执行了完整流程。私人模板图片与导出的手册不提交仓库。PDF 由 Chromium 生成，Word 使用原生 DOCX 分节及域；Word 的可视检查使用 LibreOffice，不能据此声明已完成 Microsoft Word/WPS 验收。

- 检查了封面、目录、跨页表格、SSL 证书长文本、正文说明、页眉页脚、水印和文末注脚。
- 企业模板样本中，ML307G / ML307N 的 PDF 分别为 50 / 49 页，DOCX 经 LibreOffice 转为 PDF 均为 75 页。两种渲染器分页不同属于已说明的能力边界；全文、命令与注脚另行核对。
- 复现了 160 字标题将 Word 封面拆成多页的问题。现在按标题长度和交付信息密度调整字号、留白，并对超出保守容量的封面明确报错。A4/Letter 长标题样本保留完整标题；A4 样本由 5 页恢复为封面、目录、正文共 3 页。
- 封面字段中取消适用型号时，Word 不再强制显示它。
- Markdown 格式说明提前解释合并单元格限制，推荐使用 HTML、Word 或 PDF。

容量检查是对字体和换行留有余量的估算；最终分页仍需在交付使用的 Word/WPS 和字体环境中核对。

## AI 状态与发布条件

- 现有 AI 交互和型号交付回归共 51 项通过；其中 AI 接口使用本地模拟器，检查对话、修订、原文保护、审阅和保存流程。
- 真实 HTTP AI 用例预检 13/13 就绪；没有调用模型，不代表模型准确率通过。
- 当前环境没有可用模型连接，真实调用预检返回 `blocked`、`modelExecuted=false`、请求数 `0`。
- 当前环境没有 Microsoft Word/WPS。真实模型及 Word/WPS 现场验收仍是正式稳定版发布前的待完成项；本轮不将它们记为通过。

## 复测

```sh
npm run lint
npm run typecheck
npm test
node --test tests/real-manual-browser.test.js tests/office-browser.test.js tests/template-browser.test.js
node --test tests/ai-authoring-browser.test.js tests/model-export-browser.test.js
npm run check:ai
```

`tests/real-manual-browser.test.js` 已纳入 `npm run test:browser`。它默认使用内置模板；设置 `DITA_MANUAL_TEMPLATE_FILE` 可用一份本地 `manual-v2` 模板创建独立验收副本，设置 `DITA_MANUAL_QA_DIR` 可保留下载文件和 `acceptance.json`。这两个参数都不修改原文或已有模板。

真实模型复测参见 [AI 验收说明](ai-acceptance.md)，使用已配置连接运行 `npm run check:ai -- --live`。不要把 Key、私人模板图片或真实模型原始响应提交 Git。
