# 团队版部署设计

## 首版拓扑

单台 Linux 应用服务器运行 Nginx、Node.js/systemd、SQLite 和本地工作区；GitLab/Gitea 与内部模型服务由公司既有内网平台提供。浏览器通过公司内网 HTTPS 访问。

## 目录布局

```text
/opt/dita-app/          应用代码
/etc/dita/              环境配置、SSH 配置与受保护凭证
/srv/dita/database/     SQLite 数据库
/srv/dita/workspaces/   用户独立 Clone
/srv/dita/shared/       公共模板和只读资源
/srv/dita/backups/      加密备份
/var/log/dita/          应用与审计日志
```

目录归专用 dita 系统用户所有；应用不以 root 运行。凭证目录权限应比普通工作区更严格。

## 配置项（示意）

```ini
HOST=127.0.0.1
PORT=5050
PUBLIC_ORIGIN=https://dita.intra.example
DITA_DATA_ROOT=/srv/dita
DITA_DB_PATH=/srv/dita/database/app.sqlite
DITA_GIT_ALLOWED_HOSTS=gitlab.intra.example,gitea.intra.example
DITA_AI_BASE_URL=https://llm.intra.example/v1
DITA_AI_MODEL=company-model
```

实际密钥使用环境注入或受保护文件，不进入仓库、前端或日志。AI endpoint 必须在服务端做主机白名单校验，且由网络 ACL 再次限制。

## 容量和队列

30–50 人不意味着 50 个 PDF 同时渲染。先采用有界导出队列，建议初始 1 个执行、5 个等待；压测后再调。AI 并发和请求频率按内部模型容量设置。SQLite WAL 模式，备份前采用一致性快照。

## 备份恢复

备份包括数据库、用户工作区（特别是未提交文件）、公共模板和必要的凭证恢复信息。远端 Git 不能代替本地未提交工作区备份。制定 RPO/RTO，定期在隔离目录恢复并校验文档可打开、Git 状态和模板哈希。

## 验收

- 30–50 登录用户基本负载。
- 交叉访问工作区/文件/仓库均拒绝。
- 同仓库多 Clone 并行提交与冲突检测。
- 内部 AI 可用且外部 endpoint 被拒绝。
- PDF/Word 队列容量、取消、失败恢复。
- 数据库和工作区备份恢复演练。
