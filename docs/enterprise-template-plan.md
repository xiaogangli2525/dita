# 企业交付模板：PDF 已实现，Word 规划中

PDF 已接入版本化模板包：模板选择、复制/导入、模板包分享、封面、企业标识、页眉页脚、文字/图片浅水印及分区页码。Word 已支持可编辑 DOCX 内容导出，但尚未接入企业模板；HTML/Markdown 保持原内容导出。本文后半部分记录 PDF 已实现能力，Word 章节是后续设计，不代表功能已上线。

## 操作方法

1. 打开功能手册，进入 **交付手册 → 配置**，选择型号、注脚规则和 **PDF** 格式。
2. 在 **交付版式** 中选择 1.1.0 新版的“企业标准 · 蓝绿”或“企业标准 · 简洁”，填写标题、企业名称、发布日期、文档编号和文档级别。文档版本沿用上方字段；日期不自动填写，留空的可选信息不输出。
3. 需要企业版式时点击 **新建 / 导入模板**：从所选模板复制，填写独立 ID、名称和版本；选择纸张、配色、封面风格与独立文字颜色，可上传标识、封面背景和水印图片。新版封面采用留白、信息分组和品牌页脚。“页眉、页脚与正文设置”可配置各位置字段、分隔线和 3–10 mm 正文间距；下页边距需预留页脚间距加 14 mm 的空间，上页边距需预留页眉间距加 9 mm。保存后自动选用新模板。
4. 点击 **发布前检查**，再预览或下载。检查生成真实 PDF，包括图片解码、中文字体覆盖与封面溢出检查。修改模板或交付信息使原检查失效，后续操作重新生成。
5. 给同事分享时点击 **导出所选模板包**，发送生成的 `.dita-template.json`；同事在自己的模板窗口导入，核对后点击 **保存并使用**。包内包含全部模板图片，不需要复制绝对路径或另外整理图片文件。

模板选择和交付信息按文档库、分支和当前文档保存在当前浏览器。模板包由本地服务保存，重启可用；清理浏览器站点数据会清除选择偏好，不会删除服务端模板包。更换电脑需导入模板包。演示模式只在服务进程内保留新模板，重启后清理。

## 模板与内容边界

| 层 | 内容 | 状态 |
| --- | --- | --- |
| 模板包 | 企业标识、封面、水印、配色、纸张、页边距、字号、页眉页脚及分区策略 | PDF 已支持 |
| 本次交付信息 | 标题、型号、版本、发布日期、文档编号、文档级别、企业名称 | 独立于模板包，型号来自本次交付 |
| 手册内容 | 章节、命令、图表、注脚、服务及法律说明 | 继续从已解析、过滤的 DITA 快照生成 |
| 格式适配器 | PDF 分页、背景及页码域；Word 原生 DOCX 分节、封面、页眉页脚与页码域 | PDF 已支持；Word 企业版式待实现 |

编辑器皮肤不控制客户文件版式。模板不会改写 DITA、型号注脚规则或文档保存状态。企业服务/法律说明仍应放在 DITA 主题中，通过内容复用共享，不写死在封面渲染代码中。

## 可导入的配置示例

当前模板包是一个自包含 JSON 文件，`assets` 保存以相对逻辑名称索引的 PNG/JPEG data URL；不需要 ZIP 解压。以下示例可直接保存为 `.dita-template.json` 导入：

```json
{
  "schemaVersion": 1,
  "id": "company-standard",
  "name": "企业标准手册",
  "version": "1.1.0",
  "renderer": "manual-v2",
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

内置 1.1.0 新版及 1.0.0 旧版模板无需导入。旧版模板的规范化内容和解释器输出保持不变，原绑定版本不会自动升级。导入旧包可原样保存；点击“升级新版排版”后才切换解释器，并自动递增补丁版本，旧版本继续保留。相同 ID/版本及相同内容可重复导入；同一版本内容不同会拒绝保存，需要递增版本。写入采用创建新文件的方式，同版本并发导入也不会覆盖。损坏的模板保留原文件，列表给出警告；缺少原绑定版本时必须导入该版本或明确选择替代版式。

交付记录包含模板 ID、名称、版本、解释器、规范化模板包 SHA256 和本次交付字段；包哈希包含图片资源。检查、预览与下载使用独立捕获的模板和内容，改变当前库里的选择不会修改已生成文件。模板哈希用于核对来源，记录不是完整交付包；要重现相同输出，需保留原始内容、模板包和匹配的字体/渲染环境。

应用不会自动把企业图片或模板包推送到 Git。团队可通过受控共享目录或私有仓库分发模板包。首版不提供删除模板入口，避免误删已引用版本。

## Word 企业模板适配计划

Word 不应把 PDF 页面截图化，也不应把 PDF 的分页 CSS 直接当作 DOCX 版式。应继续使用可编辑 DOCX 文档结构，建立独立的 `template-word` 适配器，读取经过校验和冻结的公共模板包及本次交付字段。

计划分三步：

1. **模板协议扩展**：允许模板声明 `pdf`、`docx` 格式能力；保持旧 PDF 模板包的规范化结果、哈希和渲染输出不变。Word 字段和版式策略使用独立 schema/renderer 版本，未知能力必须拒绝而非静默忽略。
2. **DOCX 渲染**：实现原生封面、页眉/页脚、页码域、A4/Letter 页面设置、标题样式、表格/图片边界和可选背景/水印。水印优先使用 Word 原生 DrawingML/VML 或受控图片层；不能用正文文字模拟导致分页污染。目录使用 Word TOC 字段或明确说明需在 Word 中更新。
3. **兼容验收**：自动检查 DOCX ZIP 结构、关系、页眉页脚引用、页码字段、纸张尺寸和模板元数据；再用 Microsoft Word 与 WPS 打开真实长手册，检查封面、目录、长表格、图片、注脚和分页。PDF 与 Word 不承诺相同分页。

验收必须覆盖：旧 PDF 模板包哈希和输出回归不变；DOCX 内容仍可编辑；模板版本和 SHA256 写入交付记录；无效/不支持字段阻止导出；真实手册按型号过滤后正文与注脚一致；Word/WPS 无修复提示。

## 模块职责与后续

`template-core` 负责配置校验、规范化和独立交付副本；`template-pdf` 负责把已过滤的交付 HTML 与显式配置转换为 PDF 版式。两者不访问编辑器、网络或存储。`template-store`/`template-routes` 管理本地模板版本；`delivery-templates` 管理选择、字段、导入与分享；`export` 只编排检查、预览和下载。交付记录的数据契约继续受类型检查。

PDF 服务验证分页页眉能力，不支持的 Chromium 会明确报错。文字水印转为背景图片，避免斜向文字混入复制内容；正文、命令、表格仍为可搜索文字。封面内容超过一页会阻止输出，提示缩短信息。

下一步是 Word 企业模板适配：复用模板字段和捕获协议，增加分节、封面、页眉页脚和页码域，并在实际 Office/兼容软件中验证。PDF 与 Word 不承诺相同分页。HTML 品牌样式、模板删除及完整模板编辑器另行扩展。
