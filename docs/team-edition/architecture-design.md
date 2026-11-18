# 团队版目标架构

## 1. 目标

支持 30–50 名部门用户在公司内网独立维护 DITA 文档。团队版复用个人版编辑器、DITA 解析、型号注脚、审阅、AI 提案和发布能力；新增身份、授权、隔离和运维层。

## 2. 逻辑架构

```text
Browser
  |
Nginx / HTTPS
  |
Node.js application
  +-- Authentication / Session
  +-- Authorization / Audit
  +-- RequestContext
  +-- WorkspaceManager
  +-- Existing DITA domain and authoring
  +-- Delivery / Template adapters
  +-- AI provider
  |
  +-- SQLite (users, sessions, grants, workspace metadata, audit)
  +-- Per-user local Git clones
  +-- Internal GitLab / Gitea
  +-- Internal AI endpoint
  +-- Shared immutable enterprise templates
```

保持模块化单体，不引入微服务、Kubernetes 或 Redis 作为首版前置条件。

## 3. 工作区隔离

工作区由服务端分配内部 ID，不直接把用户输入拼接为文件系统路径。每个用户对每个获准仓库拥有独立 Clone：

```text
/srv/dita/workspaces/<opaque-workspace-id>/<repository-id>/
```

同一个远程仓库的多个用户工作区互不共享工作目录、索引、未保存状态和锁。服务端每次请求通过认证身份和授权关系解析工作区，再创建 RequestContext。所有路径均做 realpath containment 校验。

## 4. 核心服务边界

- AuthService：密码验证、账户状态、登录失败节流。
- SessionStore：随机 Session、服务端会话撤销和过期。
- Authorization：角色与仓库级授权；默认拒绝。
- WorkspaceManager：创建、恢复、关闭、清理工作区。
- RequestContext：固定本次请求的用户、会话、仓库、工作区和能力。
- GitCredentialProvider：按仓库选择服务端托管凭证。
- AuditLog：记录操作者、资源、动作、结果和时间。
- TemplateRegistry：公共只读模板及版本校验。
- AI Gateway：内部模型地址白名单、并发和请求限制。

现有 DITA 领域逻辑不应读取全局“当前用户”或“当前工作区”。

## 5. 并发与持久化

锁按工作区/文档资源分区，避免不同用户互相阻塞。对同一用户同一文档的并发写入仍须进行版本/快照校验。PDF/Word 任务采用有界队列，任务记录与导出快照绑定。

SQLite 使用 WAL、外键和迁移版本；先评估单机部署与备份恢复。若未来需要多应用实例或更高写入并发，再评估 PostgreSQL，不预先引入。

## 6. 可用性边界

首版以单台应用服务器、一个持久化数据盘为目标。Git 远端仍是版本历史的权威来源；本地工作区可从远端恢复，但未提交修改必须单独备份。
