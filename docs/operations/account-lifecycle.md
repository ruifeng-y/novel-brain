# 账号生命周期

本文说明 NovelBrain 账号资料、登录凭据、笔名、注销恢复和永久删除的运行方式。

## 账号状态

| 状态 | 用户可见含义 | 登录 | 恢复 |
| --- | --- | --- | --- |
| `active` | 正常账号 | 允许 | 不需要 |
| `disabled` | 运维停用 | 拒绝 | 仅运维处理 |
| `pending_deletion` | 注销恢复期 | 拒绝，可以凭邮箱和密码恢复 | 30 天内允许 |
| `deleted` | 永久删除完成 | 拒绝 | 不允许 |

注销申请会记录 `deletion_requested_at`，并写入 `deletion_scheduled_for = deletion_requested_at + 30 days`。在到期前，作者可以从登录页进入恢复页面。

## 用户入口

- `/workspace/settings/account`：显示资料、邮箱变更、密码修改、多笔名、数据导出和注销申请。
- `/forgot-password`：发送一次性密码重置邮件。
- `/reset-password?token=...`：设置新密码。令牌 30 分钟过期，只能使用一次。
- `/recover-account`：在 30 天恢复期内恢复账号。

## 安全行为

- 修改密码、重置密码、修改邮箱都会撤销该账号的全部会话。
- 修改邮箱会向新邮箱发送 6 位验证码，最多尝试 5 次，10 分钟过期。
- 申请注销必须验证当前密码，并输入固定确认文字“注销账号”。
- 注销申请要求最近 24 小时内完成过一次完整账号导出。
- 邮箱、密码、令牌和验证码不会写入应用日志或审计元数据。
- 每个账号只能读取和修改自己的资料、笔名和待验证邮箱。

## 审计

账号级审计写入现有 `audit_logs`，`work_id` 和 `branch_id` 为空，`target_type` 为 `account` 或账号子资源。当前记录：

- 登录、退出当前设备、退出所有设备。
- 修改密码、邮件重置密码、发起和完成邮箱变更。
- 更新资料、新增/修改/删除笔名。
- 导出账号数据、申请注销、恢复账号。

永久删除前会写入 `account_purge_receipts`，保留用户 UUID、邮箱 SHA-256、申请时间、计划删除时间、完成时间和删除计数。该表只允许数据库管理员访问，用于删除证据。

## 后台清理任务

Worker 每天 03:00 通过 BullMQ `system` 队列执行一次 `account-purge`。任务只处理同时满足以下条件的账号：

- 状态为 `pending_deletion`。
- `deletion_scheduled_for <= now()`。
- 单次最多处理 100 个账号。

每个账号在独立事务中重新锁定并检查状态。删除前在事务内设置 `novel.allow_history_delete=on`，以允许级联清理不可变历史；事务提交后按用户对象前缀清理 MinIO，并把结果写回删除回执。

手动演练：

```bash
docker compose exec worker pnpm --filter @novel/worker purge:accounts -- --dry-run --limit=10
```

执行清理：

```bash
docker compose exec worker pnpm --filter @novel/worker purge:accounts -- --limit=25
```

`DATABASE_ADMIN_URL` 必须可用。没有该连接时不执行账号删除，避免受限应用角色绕过租户隔离。

## 迁移与发布检查

- 账号相关迁移：`0037`、`0038`、`0039`、`0040`、`0041`、`0042`、`0043`。
- `0044_account-lifecycle-repair.sql` 和 `0045_pen-name-auth-policy.sql` 用于兼容已存在的开发卷迁移历史，并修复注册时默认笔名的认证上下文策略。
- 发布前验证 `pnpm test`、`pnpm test:e2e`、`pnpm lint`、`pnpm typecheck` 和 `pnpm build`。
- 永久删除不可撤销；生产执行前先运行 dry-run 并确认备份保留策略与法定保留范围。
