# M2-07 站内通知与 Shell 入口

> Issue：#97
> Capability：NOTIFY-001
> Date：2026-11-12
> Branch：`codex/m2-batch-isolation`

## 1. 实现范围

- 新增租户隔离的 `notifications` 表和 RLS 策略。
- 新增通知契约：类型、目标类型、载荷、游标列表、未读数、单条已读和全部已读。
- 新增 API：列表、单条已读、全部已读，均要求会话认证；写操作要求 CSRF。
- Worker 在批量计划和单章生成事件事务内写入任务完成、任务失败和等待审核通知。
- AppShell 顶栏铃铛展示未读数，并按签收原型打开右侧通知抽屉。

## 2. 数据与幂等

- 通知按 `user_id + dedupe_key` 唯一。
- 批量计划通知的去重键为 `job:<planId>:<eventType>:<sequence>`。
- 独立单章生成通知使用 `job:<jobId>:<eventType>:<sequence>`；批量子任务不重复通知。
- 事件写入和通知写入在同一事务内完成；`job_events` 插入冲突时不重复写通知。
- 同一计划重试后再次失败或再次进入等待审核，会产生新的通知。

## 3. API 与界面

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/v1/notifications` | 按 `createdAt DESC, id DESC` 游标分页；返回总未读数 |
| PATCH | `/api/v1/notifications/:notificationId/read` | 标记当前用户的一条通知为已读 |
| POST | `/api/v1/notifications/read-all` | 标记当前用户全部未读通知 |

通知抽屉支持未读计数、加载、空、错误、单条已读和全部已读，并实现 Esc、焦点陷阱和关闭后的焦点返回。每条通知使用作者可读的任务或合并文案，并只允许跳转到站内路径。

## 4. 验证

- `packages/contracts/test/notifications.test.ts`：3 passed
- `apps/api/test/notifications.integration.test.ts`：1 passed，跨用户和 CSRF 校验通过公开 API
- `apps/api/test/batch-plan.integration.test.ts`：覆盖重复事件去重与重试后再次失败的新通知
- `apps/api/test/generation.integration.test.ts`：覆盖独立单章生成的等待审核与失败通知
- `apps/web/e2e/parity/notifications.spec.ts`：5 passed，使用真实数据库/API 覆盖抽屉、10 条未读的分页总数、单条已读、全部已读及四档视口空态
- `pnpm typecheck`：通过
- `pnpm lint`：通过
- `pnpm format:check`：通过
- `pnpm test`：57 files / 355 tests passed
- `pnpm test:integration`：28 files / 180 tests passed

## 5. 剩余边界

- Batch 四档候选截图已生成在 `artifacts/ui/candidates/m2-97-batch/`，尚未升级为正式 Golden，仍需作者视觉签收。
- changes、work-overview 以及受影响 dashboard 页面的 M2 parity 仍需在 #97 内完成。
- 合并完成/冲突通知类型和读取入口已就绪，但当前分支尚未接入可用的合并执行事件源；不得以通知契约存在代替合并流程验收。
- #91–#96 在 GitHub 上仍为 OPEN；本分支只能记录通知增量证据，不能据此关闭 #97 或宣称依赖已集成。
- 本记录不关闭 #97，也不构成 M2 端到端签收。
