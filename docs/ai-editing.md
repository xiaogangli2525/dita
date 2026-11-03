# AI 辅助写作：使用与接入边界

提供 **选区修订** 和 **粘贴问题 → 定位原文 → 连续对话修订 → 应用修改**。问题直接粘贴，不做 Excel 导入。知识库另见 [后续计划](knowledge-base-plan.md)，本轮不实施。

## 如何使用

1. 在编写模式选中同一段落内的文字，或打开功能手册。右侧 **AI 写作** / **编辑 → AI 辅助写作** 打开窗口。
2. 粘贴测试问题或填写润色要求；修改参数时附上已经核实的正确值。可填写问题涉及的型号，它不会自动给共享原文新增型号条件。
3. 已选中文字会显示具体文件和原文。其他情况下选择当前章节或功能手册，使用“定位原文”；可单独填写命令、参数等关键词改善定位。定位在本地完成，显示最多 30 个候选，需要人工选择。
4. 检查原文、适用条件和当前模型，点击“按要求修改”。只把本次/之前用户要求、上一轮累计提案、涉及型号、选定文字片段和继承条件发送到配置的服务，不发送整份手册、未选文件、文件系统路径或 Git 凭据。
5. 在底部“继续修改”直接回复，点击“发送”或 Ctrl/Cmd+Enter。可以补充正确值，或说“再简短些”。每轮携带已有要求和上一轮累计修改；有依据的部分先生成提案，缺少的技术事实单独提问。满意后点击“应用修改”，或在对话中输入“应用这版”/“按这个改”，无需额外勾选确认。
6. 应用通过既有 `setFileContent` 进入撤销/重做；可以继续修改同一位置。新一轮以应用后的原文为基线，保留已有用户要求与未解决问题。正常保存才写入文件，不会自动 Git 提交/推送。

同一文档、工作区和原文没有变化时，关闭再打开 AI 窗口会保留本次对话、提案及未发送回复。刷新页面不会保存对话；换文档/工作区或原文变化时不沿用旧提案。取消本轮保留之前提案和输入，失败时也可直接重试。“新任务”清空对话但仍使用当前修改位置。

每个任务最多 12 轮、累计用户要求最多 24000 字符；达到限制时明确提示先应用需要保留的修改，再开始新任务，不默默丢弃早期要求。

当前是文字层面的辅助修订：保留标签、内联结构、ID、属性、条件、引用和注脚位置。不自动新增章节、重构表格、创建型号条件、跨段落/文件批量修改。复用引用应先定位到定义来源；包含 Oxygen 未审核修订的选区不交给模型处理。定义可能被其他章节使用，接受前需核对共享影响。搜索可能返回相似候选，不声称自动定位必然正确。

## 模型配置

适配 **OpenAI 兼容 Chat Completions** 协议。实际兼容性和质量需在公司批准的接口上验证。当前未预设供应商、模型或密钥，不会默默选择外部服务。

从 AI 窗口右上角 **模型设置**，或 **编辑 → AI 模型连接** 打开独立连接窗口，填写 API 基础地址、模型名和 Key，点击 **保存连接**。配置一次，重启后仍有效；写作界面只显示当前模型。保存连接不会调用模型，发送修改请求时才发送文档内容。Key 输入在成功/失败后清空，响应只返回是否已配置；同接口留空保留已有 Key，换地址不会沿用旧 Key。

连接保存在运行服务的用户配置目录：Windows 为 `%APPDATA%/DITA Lite/ai-connection.json`；macOS/Linux 为 `$XDG_CONFIG_HOME/dita-lite/ai-connection.json` 或 `~/.config/dita-lite/ai-connection.json`。这是包含密钥的本地配置文件，应用使用受限目录/文件权限（POSIX 为 0700/0600），不进入文档仓库或浏览器存储。可通过 `DITA_AI_CONFIG_FILE` 指定服务端配置文件位置；应选择仓库之外的用户私有目录。已保存的界面设置优先于启动环境配置；未保存时使用环境默认值。

也可以在启动环境中固定配置，下例使用占位值：

```powershell
$env:DITA_AI_BASE_URL = 'https://your-approved-endpoint.example/v1'
$env:DITA_AI_MODEL = 'your-model-name'
$env:DITA_AI_API_KEY = 'your-secret-key'
$env:DOCS_ROOT = 'E:\work\dita\repo_http'
npm start
```

macOS/Linux 对应设置 `export DITA_AI_BASE_URL=...`、`export DITA_AI_MODEL=...`、`export DITA_AI_API_KEY=...` 后运行 `npm start`。应用不自动读取 `.env`；请通过终端或受控服务配置注入。真实密钥不要写入仓库、浏览器或测试截图。

| 配置 | 说明 |
| --- | --- |
| `DITA_AI_BASE_URL` | 基础路径，通常以 `/v1` 结尾；服务追加 `/chat/completions`。不含鉴权查询参数或 URL 用户名/密码 |
| `DITA_AI_MODEL` | 接口提供的准确模型名，必填 |
| `DITA_AI_API_KEY` | 服务端 Bearer 密钥；本机无鉴权服务可不填 |
| `DITA_AI_TIMEOUT_MS` | 超时毫秒数，默认 60000，限制在 1000–120000 |
| `DITA_AI_JSON_MODE=0` | 对不支持 JSON 模式的接口不发送 `response_format`；仍强制校验返回 JSON |
| `DITA_AI_TOKEN_PARAMETER` | 默认 `max_tokens`；要求新参数的模型可设为 `max_completion_tokens`，输出上限 4096 |
| `DITA_AI_ALLOW_HTTP=1` | 显式允许非本机的内网 HTTP 接口，默认要求 HTTPS |
| `DITA_AI_NO_AUTH=1` | 显式声明内网接口无需鉴权，不能替代应有密钥 |
| `DITA_AI_CONFIG_FILE` | 用户模型配置文件路径；不设置时使用系统用户配置目录 |

`npm run dev` 演示模式始终关闭模型连接，即使继承了密钥。真实接口使用 `npm start`；默认只监听本机。服务仍是单用户本地工作区，不是多用户 AI 网关。

## 架构与校验

- `ai-context.js`：从 Author/源码选区或 `manual-service` 快照定位候选。重复或不能准确映射的可视选区拒绝猜测。
- `ai-edit-core.js`：Node/浏览器共用的纯数据边界；用 XML source ranges 提取文字片段，校验 ID/原文匹配、重复修改、长度和 XML。按逆序源码范围替换，保留范围外原始字节，不整份序列化文档。
- `ai-authoring.js`：独立界面控制器，通过声明的端口捕获请求前 `path/current/workspaceToken`，展示结果、取消、接受/放弃。不直接写共享 state 或文档字段。
- `ai-conversation.js`：受检查的多轮上下文边界，保留用户要求与最新累计提案；结果副本不可变，应用后能基于新原文继续。
- `ai-connection.js` / `ai-settings.js` / `ai-config-store.js`：独立设置窗口、服务端连接状态及原子写入的用户配置；不存浏览器/项目文件，不返回密钥，切换地址不沿用旧 Key。
- `ai-provider.js`：服务端请求、超时/取消、最多两个并发、256 KB 响应限制、完整 JSON 与拒答检测。禁止重定向，不向浏览器回显上游错误正文或密钥。真实实现参与严格类型检查。
- `ai-routes.js`：在既有 Host/Origin/工作区 token 检查之后，只处理提交的源码快照，无工作区文件 IO；长请求不持有工作区锁，完成时再次验证 token。
- `ai-contracts.d.ts`：请求、片段、结果和配置的数据契约；运行时同样验证模型输出，JSON 模式不能替代校验。

模型返回 `summary`、`questions`、`edits[{id,before,after}]`。允许明确的修改与待补充问题同时返回；前后文字用 `textContent` 展示，修改后文字进行 XML 转义。模型不能指定路径、执行工具或改标签属性。

`document-store.createProposal` 绑定请求开始前的工作副本；`applyProposal` 检查路径、工作区和原文仍一致，再调用共享编辑接口。切换工作区、改动原文或关闭窗口会取消/丢弃未完成请求；已完成对话可在原文未变化时恢复；手册搜索还验证整个快照。不能覆盖等待期间的新编辑。`baseline`、`disk`、`current` 保持各自含义。

校验保证范围、结构和并发边界，不代表技术事实正确，也不是完整 DITA DTD 校验。参数、型号和固件范围仍需研发核对。首版采用本地关键词定位，不让模型遍历仓库，不包含向量库/知识图谱。

## 默认修改规则

每轮请求的系统消息自动包含仓库维护的 [AI 文字修订规则](ai-writing-rules.md)，不需要用户重复粘贴。服务端启动时读取这份规则，修改后重启生效。规则强调直接执行明确要求、使用此前回答、保留 DITA/型号差异，以及只追问缺少的关键技术事实。

`assistant-playbook.md` 面向仓库操作、保存和交付的自动化，不全量发送给当前文字模型。模型规则与 JSON 输出协议分开维护，实际请求包含规则正文，不是只给文件名。

## 验证范围

自动测试使用本地模拟兼容接口，覆盖真实 HTTP 请求、鉴权/token、选区与手册定位、源码保留、审核、待确认、恶意/越界输出、取消、过期原文、撤销重做、保存互不阻塞和多皮肤窄屏布局。

未配置真实模型时明确显示未配置并禁用生成；模拟测试不证明真实模型质量或供应商兼容性。实际接入后，用真实 HTTP 手册及已核实问题补做人工验收。

协议参考：[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[JSON 模式](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)。兼容接口可能仅支持部分参数。

