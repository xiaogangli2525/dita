# 团队版数据库 Schema 设计

本文件是逻辑 Schema 草案，实际 SQL 需在团队版分支实施时经迁移脚本和约束测试确认。

## users

- id：随机 UUID 主键。
- username：规范化后唯一。
- password_hash：Argon2id 哈希，不保存明文。
- display_name：显示名称。
- role：admin / editor / viewer。
- status：active / disabled。
- must_change_password：首次登录强制修改。
- created_at、updated_at、last_login_at。

## sessions

- id：随机会话 ID。
- token_hash：Cookie Token 的哈希，唯一。
- user_id：users 外键。
- created_at、expires_at、last_seen_at、revoked_at。
- user_agent_digest：可选，用于安全审计，不存储不必要的完整指纹。

## repositories

- id：内部随机 ID。
- provider：gitlab / gitea。
- remote_url：规范化后的远端地址。
- default_branch：默认分支。
- credential_ref：指向服务器凭证存储的引用，不保存私钥明文。
- status、created_at、updated_at。

## user_repositories

- user_id、repository_id 组成唯一键。
- permission：read / write / maintain。
- granted_by、granted_at、revoked_at。

## workspaces

- id：随机 UUID。
- user_id、repository_id 外键。
- local_path：由服务端生成并验证的工作区路径。
- branch、state、last_opened_at。
- created_at、updated_at。
- user_id + repository_id 唯一，除非后续明确支持同用户多工作区实例。

## audit_events

- id、actor_user_id、action、resource_type、resource_id。
- outcome、request_id、occurred_at。
- metadata_json：白名单字段，禁止写入密码、Cookie、Token、私钥或模型密钥。

## template_permissions

- template_id、template_version、subject_type、subject_id、permission。
- 首版公共模板可采用管理员发布、所有用户只读的简化策略。

## 数据约束

启用 SQLite foreign_keys；用户名、Session Token 哈希、仓库远端标识及授权组合建立唯一索引。删除用户优先软禁用并撤销会话，不级联删除工作区和 Git 历史。所有 Schema 变更使用有版本号的迁移，备份恢复需验证迁移前后兼容。
