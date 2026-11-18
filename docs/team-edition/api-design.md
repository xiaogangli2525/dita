# 团队版 API 与权限设计

API 路径仅为设计草案，最终需与现有路由命名和请求契约对齐。

## 认证

- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/session
- POST /api/auth/change-password

登录成功设置 HttpOnly、Secure、SameSite=Lax Cookie；写请求执行 CSRF 校验。登录失败统一提示并限速，避免用户名枚举。

## 用户管理（管理员）

- GET/POST /api/admin/users
- PATCH /api/admin/users/:id
- POST /api/admin/users/:id/reset-password
- POST /api/admin/users/:id/revoke-sessions

普通用户不得创建管理员或提升自身权限。

## 仓库与工作区

- GET /api/repositories：仅返回当前用户获授权仓库。
- POST /api/admin/repositories：登记远端仓库。
- POST /api/workspaces：创建或恢复获授权仓库工作区。
- GET /api/workspaces/current：读取当前工作区摘要。
- POST /api/workspaces/:id/git/fetch
- POST /api/workspaces/:id/git/push

每次请求必须验证 Session、用户状态、资源归属和仓库授权。客户端提交的路径、远端 URL、分支名都不能直接作为可信文件系统或命令参数。

## 模板与 AI

企业模板读取面向所有授权用户；发布、升级、停用仅管理员。AI 模型配置仅管理员可查看非敏感状态并修改；真实密钥不回传浏览器。AI 文档修改仍然生成提案，接受后进入共享撤销历史，正常保存才写文件。

## 统一错误语义

- 401：未登录或 Session 失效。
- 403：已登录但没有资源权限。
- 404：资源不存在；对敏感资源可统一隐藏是否存在。
- 409：文档快照、分支或版本冲突。
- 422：请求结构或业务约束不成立。
- 429：登录、AI 或导出限流。
- 5xx：服务端错误，不返回密钥、绝对路径或堆栈。
