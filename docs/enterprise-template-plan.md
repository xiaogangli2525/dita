# 企业交付模板：PDF 与 Word

PDF 企业模板已支持版本化模板包、A4/Letter、封面、Logo/背景图、页眉页脚、图片/文字水印及分区页码。Word 现已接入独立的原生 DOCX 模板渲染器：复用同一套模板包与交付字段，生成可编辑封面、分节、页眉页脚、页码域和水印。PDF 与 Word 不共享分页渲染器，也不承诺页数和分页完全一致。HTML/Markdown 继续输出内容本身。

## 操作方法

1. 打开功能手册，进入 **交付手册 → 配置**，选择型号、注脚规则和输出格式（PDF 或 Word）。
2. 在 **交付版式** 中选择支持当前格式的模板。内置 1.2.0“企业标准 · 蓝绿”和“企业标准 · 简洁”同时支持 PDF/Word；1.1.0 及更早版本仍是 PDF 模板。填写标题、企业名称、发布日期、文档编号和文档级别；日期不自动填写，留空的可选信息不输出。
3. 点击 **新建 / 导入模板** 可从当前模板复制，修改独立 ID、名称和版本；设置纸张、配色、封面风格与文字颜色，可上传 Logo、封面背景和水印图片。在“模板支持格式”中勾选 PDF 和/或 Word。旧版 PDF 模板先点击 **升级新版排版**，再启用 Word；保存为新版本，不覆盖旧模板。
4. 点击 **发布前检查**，再预览或下载。PDF 检查会执行图片解码、中文字体覆盖和封面溢出检查；Word 检查生成原生 DOCX，浏览器预览只是版式近似，最终分页需在 Microsoft Word/WPS 中核对。修改模板或交付信息会使原检查失效。
5. 给同事分享时点击 **导出所选模板包**，发送生成的 `.dita-template.json`；同事导入后核对并点击 **保存并使用**。包内包含模板图片，不需要复制绝对路径或另外整理图片文件。

模板选择和交付信息按文档库、分支和当前文档保存在当前浏览器。模板包由本地服务保存，重启可用；清理浏览器站点数据会清除选择偏好，不会删除服务端模板包。更换电脑需导入模板包。演示模式只在服务进程内保留新模板，重启后清理。

## 模板与内容边界

| 层 | 内容 | 状态 |
| --- | --- | --- |
| 模板包 | 企业标识、封面、水印、配色、纸张、页边距、字号、页眉页脚及分区策略 | PDF/Word 共用模板字段，分别渲染 |
| 本次交付信息 | 标题、型号、版本、发布日期、文档编号、文档级别、企业名称 | 独立于模板包，型号来自本次交付 |
| 手册内容 | 章节、命令、图表、注脚、服务及法律说明 | 继续从已解析、过滤的 DITA 快照生成 |
| 格式适配器 | PDF 页面背景、分区与页码域；Word 原生 DOCX 分节、封面、页眉页脚和页码域 | PDF 与 Word 均已接入独立渲染器；Word 最终分页需在 Word/WPS 中验收 |

编辑器皮肤不控制客户文件版式。模板不会改写 DITA、型号注脚规则或文档保存状态。企业服务/法律说明仍应放在 DITA 主题中，通过内容复用共享，不写死在封面渲染代码中。

## 可导入的配置示例

当前模板包是一个自包含 JSON 文件，`assets` 保存以相对逻辑名称索引的 PNG/JPEG data URL；不需要 ZIP 解压。以下示例可直接保存为 `.dita-template.json` 导入：

```json
{
  "schemaVersion": 1,
  "id": "company-standard",
  "name": "企业标准手册",
  "version": "1.2.0",
  "renderer": "manual-v2",
  "formats": [
    "pdf",
    "docx"
  ],
  "company": {
    "name": "示例公司",
    "logo": null
  },
  "page": {
    "size": "A4",
    "marginsMm": {
      "top": 24,
      "right": 20,
      "bottom": 24,
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
    ],
    "textColor": "#145A78"
  },
  "header": {
    "left": "",
    "center": "",
    "right": "company.name",
    "rule": true,
    "gapMm": 4
  },
  "footer": {
    "left": "manual.documentId",
    "center": "",
    "right": "page.currentTotal",
    "rule": true,
    "gapMm": 6
  },
  "watermark": {
    "enabled": true,
    "asset": null,
    "text": "company.name",
    "opacity": 0.06,
    "source": "auto",
    "fit": "logo",
    "widthPercent": 80,
    "offsetYPercent": 53,
    "rotationDeg": 0,
    "tone": "grayscale"
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

字段白名单为 `manual.title`、`manual.model`、`manual.version`、`manual.releaseDate`、`manual.documentId`、`manual.classification`、`company.name`。页眉页脚额外支持 `page.current`、`page.total`、`page.currentTotal`，空字符串表示不显示。页码当前按物理页从 1 计数；封面隐藏页码，目录页按 `frontMatter` 配置，正文按 `body` 配置。法律声明等普通 DITA 主题属于正文，不自动归入目录分区。新版水印来源分为自动选图、企业 Logo、专用水印图和文字。自动选图先用专用图，再用企业 Logo；没有图片时明确提示未配置，不会自动变成企业名称。文字水印需明确选择。

`schemaVersion` 是配置协议版本，`version` 是企业模板版本，`renderer` 是布局解释器。新版解释器为 `manual-v2`，支持品牌页脚和简洁留白两种封面；旧版 `manual-v1` 仍保留原配置与渲染路径。不执行包内 JavaScript、任意 HTML/CSS 或网络请求。未知字段及尚未支持的格式/页码策略会被拒绝，避免导入后静默丢失设置。更复杂的封面结构应新增受控解释器，不能在交付控制器里按企业名称增加分支。

## 水印与页脚细节

Logo 水印保持上传原图的形状与宽高比，不重新绘制。水印预览显示当前选用的真实图片、大小与位置；图片可选灰度或原色。标识图可配置页面宽度 25–90%、垂直位置 30–70% 与角度 -45° 至 45°；默认横向展示。整页水印图保留原图布局，宽度、位置和角度不再单独调整。

界面不透明度使用 1–100% 表示，配置中仍为 0.01–1。已自带淡化或透明度的原水印图可使用 100%，避免重复淡化；普通彩色 Logo 建议先用较低值，通过真实 PDF 核对。旧版仍沿用原 0.01–0.15 范围。模板包保留图片字节和 alpha，不会为水印重画商标。

新版水印以整张纸为坐标，补偿正文页边距，避免偏右、偏下或裁边。页脚默认左侧文档编号、右侧当前页/总页数，提供浅色细分隔线，并在正文、页脚和纸边间保留空间。过长的页眉页脚字段在显示时省略，交付记录仍保留完整字段。封面文字色独立于正文品牌色，便于使用浅色或深色背景。

## 存放、版本与追溯

模板默认保存在运行服务的用户配置目录：

- Windows：`%APPDATA%/DITA Lite/templates`。
- macOS/Linux：`$XDG_CONFIG_HOME/dita-lite/templates`，未设置时为 `~/.config/dita-lite/templates`。
- `DITA_TEMPLATE_DIR` 可指定本机企业模板目录；与文档仓库分开配置。

内置 1.2.0 双格式模板、1.1.0 PDF 新版及 1.0.0 PDF 旧版模板无需导入。既有 1.0.0/1.1.0 模板的规范化内容和 PDF 解释器输出保持不变，原绑定版本不会自动升级。导入旧包可原样保存；点击“升级新版排版”后才切换解释器，并自动递增补丁版本，旧版本继续保留。相同 ID/版本及相同内容可重复导入；同一版本内容不同会拒绝保存，需要递增版本。写入采用创建新文件的方式，同版本并发导入也不会覆盖。损坏的模板保留原文件，列表给出警告；缺少原绑定版本时必须导入该版本或明确选择替代版式。

交付记录包含模板 ID、名称、版本、解释器、规范化模板包 SHA256 和本次交付字段；包哈希包含图片资源。检查、预览与下载使用独立捕获的模板和内容，改变当前库里的选择不会修改已生成文件。模板哈希用于核对来源，记录不是完整交付包；要重现相同输出，需保留原始内容、模板包和匹配的字体/渲染环境。

应用不会自动把企业图片或模板包推送到 Git。团队可通过受控共享目录或私有仓库分发模板包。首版不提供删除模板入口，避免误删已引用版本。

## 模块职责与后续

`template-core` 负责配置校验、规范化和独立交付副本；`template-pdf` 负责把已过滤的交付 HTML 与显式配置转换为 PDF 版式；`template-word` 负责把相同的发布快照和模板字段转换为原生 DOCX 分节、封面、页眉页脚和水印。两种渲染器不访问编辑器、网络或存储。`template-store`/`template-routes` 管理本地模板版本；`delivery-templates` 管理格式筛选、选择、字段、导入与分享；`export` 只编排检查、预览和下载。交付记录的数据契约继续受类型检查。

PDF 服务验证分页页眉能力，不支持的 Chromium 会明确报错。文字水印转为背景图片，避免斜向文字混入复制内容；正文、命令、表格仍为可搜索文字。封面内容超过一页会阻止输出，提示缩短信息。

Word 企业模板首版已接入。目录使用原生 Word TOC 域，包含章节书签、内部链接和 PAGEREF 页码字段；首次打开后应在 Word/WPS 中更新整个目录以刷新页码。后续重点是实际分页、字体与打印验收、模板版本管理体验，以及按需扩展 HTML 品牌样式。PDF 与 Word 不承诺相同分页。
