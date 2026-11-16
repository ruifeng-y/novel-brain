# M3-03c 账号导出、注销恢复期与永久删除生命周期

> Issue: #134
> Capabilities: ACCT-005, ACCT-006, IO-006, SEC-004
> UI parity: `account-settings`
> Status: implementation and visual signoff complete; #136 downstream restore evidence pending

## 1. 交付范围

- `export_receipts` 保存账号完整导出包的版本、inventory、SHA-256、字节数、生成时间和 7 天有效期。
- Worker 定时删除已过期 export receipt 及其 payload，避免过期导出包继续占用数据库。
- `deletion_requests` 保存账号注销状态机、30 天恢复截止时间、永久删除时间、备份过期时间和逐 store 结果。
- `users.status` 增加 `deletion_pending` 生命周期状态；处于该状态时只允许读取身份、读取删除状态和执行恢复，其他业务 API 仍关闭。
- Worker 在 `purge_after` 到期后执行账号级永久删除；BullMQ 只负责投递，Postgres 中的删除请求是权威状态。
- Worker 每分钟扫描到期的 Postgres 删除请求，防止仅依赖 Redis delayed job 造成遗漏。
- 账号级 worker job 沿用 ADR 0024 的 typed contract：显式携带 `workId: null`、`branchId: null`、`idempotencyKey` 和版本化 checkpoint，不伪造作品或分支 ID。
- 账号设置页提供导出、导出凭证门禁、二次确认注销、30 天恢复、恢复期展示和 partial failure 展示。
- 账号导出按用户和 IP 限流，并写入 `account.exported` 审计记录。
- `Idempotency-Key` 在 24 小时内返回同一 export receipt 或 deletion request；同一 key 的重放不重复消耗导出创建额度。
- 账号导出先用用户级 advisory lock 串行化，再开启 `REPEATABLE READ` 快照逐表读取，避免并发同 key 冲突和跨表时点不一致。

## 2. 导出 inventory

导出器从 PostgreSQL catalog 发现所有带 `user_id`、`work_id` 或 `branch_id` 的 public 表，并额外覆盖 `users`、`audit_logs` 与按邮箱归属的 `email_verification_codes`。当前 inventory 为 103 个 store，版本标识为 `account-export-v1`。

- 不导出 `deletion_requests` 与 `export_receipts`，避免导出包在自身生命周期元数据中递归。
- 移除 `users.password_hash`、`sessions.token_hash`、`password_resets.token_hash`、`email_verification_codes.code_hash`、`model_configs.encrypted_key` 和 `model_configs.idempotency_key`。
- 导出包是稳定 JSON，receipt 的 `checksum` 为完整 JSON UTF-8 字节的 SHA-256。
- 集成测试用租户 RLS inventory 对照 exporter 的表集合，防止新增租户表后静默漏导出。

## 3. 删除状态机

```text
active
  -> POST /users/me/delete(exportReceiptId, confirm=true)
deletion_pending + recovery_pending
  -> POST /users/me/deletion/recover       => recovered + active
  -> purge_after reached                   => purging
  -> all stores deleted                    => completed, user_id/export_receipt_id 置空
  -> retryable store failure               => failed + retryable report
```

- 申请注销要求当前账号拥有且仍在有效期内的导出 receipt；其他账号的 receipt 返回租户隔离错误。
- 重复申请返回同一个开放删除请求，不创建第二条记录。
- 恢复只在 `recoverable_until` 之前允许；重复恢复幂等，过期恢复返回稳定错误。
- 永久删除逐表报告 `store`、`rowCount`、`status`、`retryable` 和 `errorCode`。
- 删除事务失败时整体回滚，删除请求保留 `failed` 和 retryable 报告；Worker 重试成功后转为 `completed`。
- `deletion_requests` 在账号硬删除后保留无用户外键的完成 tombstone，不保存邮箱、正文、Key 或其他账号数据。

## 4. 备份与 #136 契约

- `purge_after = requested_at + 30 days`。
- `backup_expires_at = purge_after + 30 days`。
- #136 必须证明：包含已删除记录的历史备份在 `backup_expires_at` 前过期；恢复后不得重新暴露已永久删除账号的数据。
- #136 的对象存储恢复、孤儿清理和 RPO/RTO 证据消费本契约，不反向修改账号恢复期。

当前生产 schema 尚未引入作者文件/导出对象 key；后续 #129 或 #136 新增对象存储数据时，必须将用户前缀、下载产物和孤儿清理登记到同一删除 inventory，并在 release gate 前补对象存储删除证据。

## 5. 验证证据

- contract：导出 receipt、删除请求和 purge worker job 的共享 Zod schema。
- API integration：完整 inventory、checksum、secret 排除、下载、导出凭证门禁、跨用户隔离、幂等注销、恢复和过期恢复。
- Worker integration：真实 Postgres 下完整删除、逐 store 报告、数据库锁触发 retryable failure、解锁后重跑成功。
- RLS integration：新增 `export_receipts` 与 `deletion_requests` 均启用并强制 RLS。
- Playwright：导出下载、二次确认注销、四档恢复页、恢复后回到正常账号页和 partial failure 作者语言。
- Visual baseline：账号设置页新增“数据与隐私”panel，必须生成 Linux Golden 并由作者签收后才能把 account-settings 页提升为最终 parity 证据。
