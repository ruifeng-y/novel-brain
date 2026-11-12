# M2-03b 调用成本预留、结算、预算硬停与报告

> Issue：#150
> Capability：GEN-011
> Date：2026-11-11
> Branch：`codex/m2-150`

## 1. 实现范围

- 批量计划新增 `costBudgetPolicy`：单章、单卷、任务级和每 1 万字字符成本上限均可独立配置。
- `batch-cost-v1` 纯函数计算最紧的可用预算，并返回绑定范围。
- 创建批量子任务时按当前任务与卷累计成本计算有效单章预算；预算耗尽时不创建模型调用，计划进入 `paused` 并写入 `job.budget.exceeded`。调用前预留失败与调用后超支同样写入该事件。
- `CostLedger` 在同一 plan 行锁内聚合任务与卷已结算/已预留成本；并发预留只能有一个跨过任务上限。
- 新增成本报告 API，按卷、章、模型或日期聚合 token、费用、时延/吞吐、失败调用与硬停记录；单次最多返回 500 个分组和 100 条硬停。
- 报告返回章节状态计数和已完成章节数；吞吐仅按已完成章节计算，避免失败或暂停章节虚增吞吐。
- Batch 页面展示任务成本、剩余任务预算和成本硬停状态。

## 2. API

- `GET /api/v1/works/:workId/branches/:branchId/batch-plans/:planId/cost-report?groupBy=volume|chapter|model|time`

## 3. 数据与预算语义

- 复用 `cost_reservations`、`model_calls`、`jobs.cost`、`job_events`，不建立第二套成本账本。
- 父计划 Job 的 `budget` JSON 保存预算策略、预计字符数和每万字成本总上限。
- 子章节 Job 的 `maxCostCny` 取单章、任务剩余、卷剩余和每万字剩余的较小值。
- 并发预留通过父计划行锁串行化；实际成本超预留时复用既有 overrun、结算和人工恢复路径。
- 报告不读取或返回 prompt、正文、上下文包正文或 Provider Key。

## 4. UI

- `apps/web/components/batch-workspace.tsx`
- 展示每个关联计划的已结算费用、任务剩余预算和成本耗尽状态。

## 5. 验证

- `packages/core/test/batch-cost.test.ts`
- `packages/contracts/test/batch-cost.test.ts`
- `apps/api/test/batch-plan.integration.test.ts`：并发任务预算与成本报告通过
- `apps/worker/test/budgeted-provider-call.test.ts`：预算拒绝发生在 Provider 调用前
- `apps/web/e2e/parity/batch.spec.ts`
- `pnpm check`
- `pnpm test:integration`
- `pnpm --filter @novel-brain/api openapi:check`

## 6. 边界

- Provider 价格自动刷新和账户计费不在 V1 范围。
- 通知和最终 Batch 页面 parity 由 #97 收口。
