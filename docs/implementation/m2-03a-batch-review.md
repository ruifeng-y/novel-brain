# M2-03a 批量审核队列与自动通过谓词

> Issue：#149
> Capabilities：GEN-010、QUALITY-004
> Date：2026-11-11
> Branch：`codex/m2-149`

## 1. 实现范围

- 新增共享审核契约：章节/卷审核目标、风险等级、风险原因、队列项、领取请求、逐项决策与部分失败结果。
- 新增固定谓词 `batch-review-v1`。只有同时满足自动审批模式、锁定大纲、无高风险待确认、黄金三章已锁定（前三章适用）、当前质量报告六维均达到 4/5、无 P0/P1/结构性问题时，章节才允许自动通过。
- 卷末和任何卷目标永远转人工确认；逐卷模式在卷内非末章继续执行，在卷末汇总为一个卷审核项，不把逐卷审批退化为逐章打断。
- 新增 `batch_review_items`、`batch_review_decision_batches`、`batch_review_decisions`，全部启用并强制 RLS。
- 决策接口支持独立领取、批量批准/驳回、乐观并发版本、逐项部分失败和 `Idempotency-Key` 完整回放。
- 自动通过和人工决策均写入 `review_decisions` 与 `audit_logs`；卷审核只处理同一批量计划内的工作项。
- Batch 页面新增真实审核队列、风险原因、质量摘要、领取、批准/驳回、部分失败和响应式状态。

## 2. API

- `GET /api/v1/works/:workId/branches/:branchId/review-queue`
- `POST /api/v1/works/:workId/branches/:branchId/review-queue/claim`
- `POST /api/v1/works/:workId/branches/:branchId/review-queue/decisions`

## 3. 数据与迁移

- `packages/db/migrations/0046_flowery_silk_fever.sql`
- 迁移从当前 `origin/main` 的 `0045_amused_vengeance.sql` 连续接续，替代未合并 M2 分支原有的断链 `0047`。
- `job_work_items`、`batch_review_items`、`batch_review_decision_batches`、`batch_review_decisions` 均使用 tenant RLS。

## 4. UI

- `apps/web/app/workspace/[workId]/batch/page.tsx`
- `apps/web/components/batch-workspace.tsx`
- `apps/web/e2e/parity/batch.spec.ts`
- 覆盖空态、错误、领取、部分失败和 390/900/1180/1440 四档无横向溢出。

## 5. 验证

- `packages/contracts/test/batch-review.test.ts`
- `packages/core/test/batch-review.test.ts`
- `apps/api/test/batch-plan.integration.test.ts`：9/9 通过
- `apps/web/e2e/parity/batch.spec.ts`：3/3 通过
- `pnpm check`：通过；54 个测试文件、347 项测试通过
- `pnpm test:integration`：通过；27 个测试文件、178 项测试通过
- `pnpm --filter @novel-brain/api typecheck`
- `pnpm --filter @novel-brain/worker typecheck`
- `pnpm --filter @novel-brain/web typecheck`
- `node scripts/validate-migrations.mjs`
- `node scripts/validate-readiness.mjs`
- `pnpm --filter @novel-brain/api openapi:generate`
- `pnpm --filter @novel-brain/api openapi:check`

## 6. 边界

- 成本预留、预算硬停和任务中心报告由 #150 继续实现。
- 通知、完整 Batch 控制和 M2 页面最终 parity 由 #97 收口。
- Batch 生产 golden 仍需按 ADR 0027 由作者视觉签收；本 ticket 不把页面标为 `parity-verified`。
