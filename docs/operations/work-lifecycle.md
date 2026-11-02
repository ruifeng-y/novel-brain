# 作品生命周期与永久清理

本文说明作品归档、软删除、恢复、复制和 30 天永久清理的运维方式。

## 作者可见状态

| 状态 | 作者可见含义 | 默认书架 | 可恢复 |
| --- | --- | --- | --- |
| `active` | 正常作品 | 显示 | 不需要 |
| `archived` | 已归档 | 不显示 | 可以 |
| 软删除 | 回收站 | 不显示 | 30 天内可以 |
| 永久删除 | 已清理 | 不显示 | 不可以 |

软删除写入 `works.deleted_at`。归档和软删除都不立即删除分支、正文、设定、版本、审计或对象存储。

## 永久清理任务

Worker 每天 03:15 通过 BullMQ `system` 队列执行一次 `work-purge`。任务只处理
`deleted_at <= now() - 30 days` 的作品，单次最多 100 个。

每个作品在独立事务中重新锁定并检查删除时间，然后：

1. 记录分支、章节、正文版本、地图图片、导出任务和作品审计计数。
2. 设置事务级 `novel.allow_history_delete=on`。
3. 删除 `works` 行，依赖外键级联清理分支、正文、设定、大纲、版本、地图和导出记录。
4. 写入 `work_purge_receipts`。回执保留作品 UUID、作者 UUID、标题 SHA-256、删除时间、清理时间和计数，不保留标题或正文。
5. 写入账号级 `audit_logs`，动作是 `work_purged`，`work_id` 和 `branch_id` 置空，使审计在作品级联后仍然存在。
6. 对该作品此前的对象键做全局引用检查，只删除没有任何剩余引用的对象。

## 对象存储引用

永久清理会检查以下引用，任一存在时保留对象：

- 其他作品的地图图片 `map_images.storage_key`。
- 其他作品的导出文件 `export_jobs.file_key`。
- 账号完整导出文件 `account_export_jobs.file_key`。
- 作者头像 `users.avatar_url`。
- 笔名头像 `pen_names.avatar_url`。

对象清理失败不会回滚已经完成的数据库清理；失败计数和错误会写入
`work_purge_receipts.summary.objectStorage`，便于后续排查。

## 复制作品与地图资源

复制作品会复制故事圣经、设定、大纲、地图结构和地图标记，但不复制正文。每个复制后的地图图片会读取源对象并写入新的对象键，键前缀使用新作品和新主创作线。复制失败时会尽力删除新对象并让数据库事务回滚。

因此删除、替换或永久清理原作品的地图对象，不会破坏复制作品。

## 手动演练

预览候选作品，不删除数据库或对象：

```bash
docker compose exec worker pnpm --filter @novel/worker purge:works -- --dry-run --limit=10
```

执行清理：

```bash
docker compose exec worker pnpm --filter @novel/worker purge:works -- --limit=25
```

运维演练可在隔离环境中固定时间窗口：

```bash
docker compose exec worker pnpm --filter @novel/worker purge:works -- --dry-run --limit=10 --now=2026-11-03T00:00:00.000Z
```

`DATABASE_ADMIN_URL` 必须可用。生产执行前先运行 dry-run，确认候选数量、备份保留和
法定保留范围。

## 验证

- `apps/worker/src/works/work-purge.runner.spec.ts` 覆盖 dry-run、批量上限、级联、回执、审计和引用保留。
- `apps/api/test/works.e2e-spec.ts` 覆盖复制地图资源后的独立对象键，以及删除一个对象后另一个作品仍可读取。
- 迁移：`0048_stiff_gargoyle.sql`（归档元数据）、`0049_sticky_dark_beast.sql`（永久清理回执）。
