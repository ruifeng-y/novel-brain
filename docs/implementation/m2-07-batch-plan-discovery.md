# M2-07 Batch 暂停计划发现

> Issue：#97
> Capability：GEN-010、GEN-011
> Date：2026-11-12
> Branch：`codex/m2-batch-isolation`

## 1. 缺口

Batch 页面原先只从审核队列提取 `planId`。当计划因预算硬停暂停、审核队列为空时，页面无法发现该计划，也无法展示成本硬停状态。

## 2. 实现

- `GET /api/v1/works/:workId/branches/:branchId/batch-plans?status=paused&cursor=...&limit=...`
- 列表按作品、分支、租户和 `batch_plan` 类型隔离，使用 `createdAt DESC, id DESC` 游标分页。
- Batch 页面先加载全部暂停计划，再合并审核队列中的计划；暂停计划优先，避免被队列容量挤占。
- 暂停计划列表或单个计划详情加载失败时，保留已加载内容并显示可刷新的部分失败提示。

## 3. 验证

- `packages/contracts/test/batch-plan.test.ts`
- `apps/api/test/batch-plan.integration.test.ts`
- `apps/web/e2e/parity/batch.spec.ts`：空审核队列 + 暂停预算计划
- 四档候选截图：`artifacts/ui/candidates/m2-97-batch/batch-{390,900,1180,1440}.png`

## 4. 边界

本记录只收口 #97 的 Batch 暂停计划发现缺口。Batch 正式四档 Golden、作者视觉签收、通知生命周期以及 changes/shell/work-overview parity 仍按 #97 的其他验收项跟踪；当前候选截图尚未升级为正式 Golden。
