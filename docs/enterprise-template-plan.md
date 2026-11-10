# 企业 PDF 模板：使用与扩展

首版已接入 PDF：模板选择、复制/导入、模板包分享、封面、企业标识、页眉页脚、文字/图片浅水印及分区页码。Word 仍沿用原有可编辑内容导出，企业模板尚未接入 Word；HTML/Markdown 保持原内容导出。

## 操作方法

1. 打开功能手册，进入 **交付手册 → 配置**，选择型号、注脚规则和 **PDF** 格式。
2. 在 **交付版式** 中选择“企业标准 · 蓝绿”或“企业标准 · 简洁”，填写标题、企业名称、发布日期、文档编号和文档级别。文档版本沿用上方字段；日期不自动填写，留空的可选信息不输出。
3. 需要企业版式时点击 **新建 / 导入模板**：从所选模板复制，填写独立 ID、名称和版本；选择纸张、配色、封面风格与水印，可上传标识、封面背景和水印图片。“页眉、页脚与正文设置”可配置各位置字段及正文开关。保存后自动选用新模板。
4. 点击 **发布前检查**，再预览或下载。检查生成真实 PDF，包括图片解码、中文字体覆盖与封面溢出检查。修改模板或交付信息使原检查失效，后续操作重新生成。
5. 给同事分享时点击 **导出所选模板包**，发送生成的 `.dita-template.json`；同事在自己的模板窗口导入，核对后点击 **保存并使用**。包内包含全部模板图片，不需要复制绝对路径或另外整理图片文件。

模板选择和交付信息按文档库、分支和当前文档保存在当前浏览器。模板包由本地服务保存，重启可用；清理浏览器站点数据会清除选择偏好，不会删除服务端模板包。更换电脑需导入模板包。演示模式只在服务进程内保留新模板，重启后清理。

## 模板与内容边界

| 层 | 内容 | 状态 |
| --- | --- | --- |
| 模板包 | 企业标识、封面、水印、配色、纸张、页边距、字号、页眉页脚及分区策略 | PDF 已支持 |
| 本次交付信息 | 标题、型号、版本、发布日期、文档编号、文档级别、企业名称 | 独立于模板包，型号来自本次交付 |
| 手册内容 | 章节、命令、图表、注脚、服务及法律说明 | 继续从已解析、过滤的 DITA 快照生成 |
| 格式适配器 | PDF 分页、背景及页码域；后续 Word 分节与页码域 | PDF 已支持；Word 企业版式待接入 |

编辑器皮肤不控制客户文件版式。模板不会改写 DITA、型号注脚规则或文档保存状态。企业服务/法律说明仍应放在 DITA 主题中，通过内容复用共享，不写死在封面渲染代码中。

## 可导入的配置示例

当前模板包是一个自包含 JSON 文件，`assets` 保存以相对逻辑名称索引的 PNG/JPEG data URL；不需要 ZIP 解压。以下示例可直接保存为 `.dita-template.json` 导入：

```json
{
  "schemaVersion": 1,
  "id": "company-standard",
  "name": "企业标准手册",
  "version": "1.0.0",
  "renderer": "manual-v1",
  "formats": [
    "pdf"
  ],
  "company": {
    "name": "示例公司",
    "logo": null
  },
  "page": {
    "size": "A4",
    "marginsMm": {
      "top": 22,
      "right": 18,
      "bottom": 20,
      "left": 22
    }
  },
  "typography": {
    "bodyFont": "Noto Sans CJK SC",
    "bodySizePt": 10.5
  },
  "colors": {
    "primary": "#145A78",
    "accent": "#7DB47B",
    "text": "#202B33"
  },
  "cover": {
    "enabled": true,
    "layout": "brand-panel",
    "background": null,
    "fields": [
      "manual.title",
      "manual.model",
      "manual.version",
      "manual.releaseDate",
      "manual.documentId",
      "manual.classification"
    ]
  },
  "header": {
    "left": "",
    "center": "",
    "right": "company.name",
    "rule": true
  },
  "footer": {
    "left": "page.current",
    "center": "",
    "right": "manual.documentId"
  },
  "watermark": {
    "enabled": true,
    "asset": null,
    "text": "company.name",
    "opacity": 0.06
  },
  "regions": {
    "cover": {
      "header": false,
      "footer": false,
      "watermark": false
    },
    "frontMatter": {
      "header": true,
      "footer": false,
      "watermark": true
    },
    "body": {
      "header": true,
      "footer": true,
      "watermark": true
    }
  },
  "numbering": {
    "basis": "physical",
    "startAt": 1
  },
  "assets": {}
}
```

资源示例：上传标识后，`company.logo` 为 `assets/logo.png`，`assets["assets/logo.png"]` 为图片 data URL。只能使用包内资源；每张图片不超过 500 KB，最多三张，界面限制最大边长 8000 像素。矢量图和商业字体嵌入暂不支持。默认使用 Noto/微软雅黑/系统字体回退，PDF 服务检测中文缺字；环境准备见 `npm run check:pdf`。

字段白名单为 `manual.title`、`manual.model`、`manual.version`、`manual.releaseDate`、`manual.documentId`、`manual.classification`、`company.name`。页眉页脚额外支持 `page.current`、`page.total`、`page.currentTotal`，空字符串表示不显示。页码当前按物理页从 1 计数；封面隐藏页码，目录页按 `frontMatter` 配置，正文按 `body` 配置。法律声明等普通 DITA 主题属于正文，不自动归入目录分区。未填写水印来源字段且未选图片时不显示水印。

`schemaVersion` 是配置协议版本，`version` 是企业模板版本，`renderer` 是布局解释器。本版解释器为 `manual-v1`，支持品牌色块和简洁留白两种封面；不执行包内 JavaScript、任意 HTML/CSS 或网络请求。未知字段及尚未支持的格式/页码策略会被拒绝，避免导入后静默丢失设置。更复杂的封面结构应新增受控解释器，不能在交付控制器里按企业名称增加分支。

## 存放、版本与追溯

模板默认保存在运行服务的用户配置目录：

- Windows：`%APPDATA%/DITA Lite/templates`。
- macOS/Linux：`$XDG_CONFIG_HOME/dita-lite/templates`，未设置时为 `~/.config/dita-lite/templates`。
- `DITA_TEMPLATE_DIR` 可指定本机企业模板目录；与文档仓库分开配置。

内置模板无需导入。相同 ID/版本及相同内容可重复导入；同一版本内容不同会拒绝保存，需要递增版本。写入采用创建新文件的方式，同版本并发导入也不会覆盖。损坏的模板保留原文件，列表给出警告；缺少原绑定版本时必须导入该版本或明确选择替代版式。

交付记录包含模板 ID、名称、版本、解释器、规范化模板包 SHA256 和本次交付字段；包哈希包含图片资源。检查、预览与下载使用独立捕获的模板和内容，改变当前库里的选择不会修改已生成文件。模板哈希用于核对来源，记录不是完整交付包；要重现相同输出，需保留原始内容、模板包和匹配的字体/渲染环境。

应用不会自动把企业图片或模板包推送到 Git。团队可通过受控共享目录或私有仓库分发模板包。首版不提供删除模板入口，避免误删已引用版本。

## 模块职责与后续

`template-core` 负责配置校验、规范化和独立交付副本；`template-pdf` 负责把已过滤的交付 HTML 与显式配置转换为 PDF 版式。两者不访问编辑器、网络或存储。`template-store`/`template-routes` 管理本地模板版本；`delivery-templates` 管理选择、字段、导入与分享；`export` 只编排检查、预览和下载。交付记录的数据契约继续受类型检查。

PDF 服务验证分页页眉能力，不支持的 Chromium 会明确报错。文字水印转为背景图片，避免斜向文字混入复制内容；正文、命令、表格仍为可搜索文字。封面内容超过一页会阻止输出，提示缩短信息。

下一步是 Word 企业模板适配：复用模板字段和捕获协议，增加分节、封面、页眉页脚和页码域，并在实际 Office/兼容软件中验证。PDF 与 Word 不承诺相同分页。HTML 品牌样式、模板删除及完整模板编辑器另行扩展。
