# M2-01b 批量工作项执行、暂停恢复与失败隔离

> Issue：#152
> Capability：GEN-008
> 分支：`codex/m2-batch-isolation`
> 日期：2026-11-07

> 依赖：本分支 stacked 在 batch-free 的 `codex/m1-full-loop` 上，原因和拆分清单见 #164 与 `m1-m2-scope-split.md`。

## 1. 实现范围

- 新增批量控制 API：
  - `POST /works/:workId/branches/:branchId/batch-plans/:planId/start`
  - `POST .../pause`
  - `POST .../resume`
  - `POST .../cancel`
  - `POST .../retry`
- 新增小载荷 `batch_tick` worker job：每次只领取一个可执行章节，创建或复用一条 `generate_chapter` 子任务并加入现有 Worker 队列，不在 tick 内同步跑完整章。
- 子任务完成、失败、暂停或取消后，Worker 读取父计划并触发下一次 tick；子任务继续复用 #115 的 `job_steps`、`job_checkpoints`、`job_step_attempts` 和恢复语义。
- 新增 `job_work_items.status = paused`，并补充 `jobs(parent_job_id, created_at)` 索引。
- 暂停在当前步骤结束后生效：Worker 在步骤边界检查 `paused`，`startStep` 在暂停/取消状态下拒绝启动新步骤。
- 失败章节不阻塞同卷兄弟章节；卷内兄弟仍可继续执行。卷边界或逐章审核时计划进入 `waiting_review`。
- 计划控制动作带 `Idempotency-Key`、租户锁、`audit_logs`、`idempotency_records` 和去重事件；重复 tick 不重复推进状态。
- 取消保留已完成和待审核章节，释放子任务遗留的 `reserved` 成本预留，并把中断中的模型调用/Agent run 标记为取消失败。

## 2. 关键不变量

- 批量执行不绕过审核：`waiting_review` 不会自动变成 `succeeded`。审批与自动通过条件由 #149 负责。
- `resume` 只接受 `paused`；`waiting_review` 需要审批流程推进，不能用恢复按钮隐式批准。
- 重试从最后未成功步骤继续；已成功的工作项步骤保持 `succeeded`，不会回到首步。
- 批量子任务使用稳定幂等键 `batch:<planId>:<chapterId>`；同一章节不会创建重复子任务。
- 所有批量控制、工作项、子任务查询和更新都带 `user_id`，并继续受 RLS 保护。
- 3,000–4,000 章计划不生成超大 queue payload；tick payload 只包含计划与租户标识，UI 通过分页工作项和聚合计数读取进度。

## 3. 变更文件

- `packages/contracts/src/index.ts`
- `packages/core/src/batch-execution.ts`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0047_remarkable_krista_starr.sql`
- `apps/api/src/batch-plan/*`
- `apps/worker/src/batch-plan/*`
- `apps/worker/src/generation/generation.processor.ts`
- `apps/worker/src/generation/generation.repository.ts`
- `apps/worker/src/worker.service.ts`
- `apps/worker/src/worker.module.ts`
- `apps/api/openapi.json`
- `apps/api/src/generated/openapi.d.ts`

## 4. 验证证据

- `packages/core/test/batch-execution.test.ts`：6/6 通过。覆盖子任务状态映射、失败隔离、review 边界、进度、乱序事件幂等和控制动作门禁。
- `packages/contracts/test/batch-plan.test.ts`：3/3 通过。覆盖控制请求、`paused` 状态和 bounded tick payload。
- `apps/api/test/batch-plan.integration.test.ts`：6/6 通过，连接真实 PostgreSQL 16 + Redis。覆盖：
  - start/pause/resume/cancel/retry、幂等重放、审计和跨租户拒绝；
  - 暂停后 `startStep` 在安全步骤边界拒绝继续；
  - 失败章节后同卷兄弟继续执行，协调器重启复用同一子任务；
  - 重复 tick 不改变终态、不重复失败事件；
  - 重试失败章节生成 `job_recoveries` 并保留已完成步骤；
  - 4,000 章计划只产生一条子任务，tick payload 小于 500 字节。
- `pnpm check`：格式、Lint、全仓类型检查、`263/263` 单测通过。
- `pnpm test:integration`：`148/148` 通过。
- OpenAPI 已重新生成。

## 5. 已知边界

- 审核队列、低风险自动通过和卷末审批决策仍由 #149 实现；本 issue 只负责执行生命周期与人工暂停/恢复。
- 成本账本和预算策略由 #150 实现；本 issue 只释放取消时遗留的预留，并使用现有单章预算默认值。
- 站内通知去重由 #97 集成；本 issue 保证状态转换和 `job_events` 幂等。
