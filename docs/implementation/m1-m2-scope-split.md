# M1 / M2 Batch Scope Split

> Issue: #164
> Date: 2026-11-08
> M1 branch: `codex/m1-full-loop`
> M2 branch: `codex/m2-batch-isolation`

## Decision

Batch planning and execution are M2 work and do not belong to M1 release acceptance. The M1 tree no longer registers batch APIs, Worker queues, contracts, tables, migrations, tests or acceptance evidence.

The M2 implementation is preserved on `codex/m2-batch-isolation`. Because #91 depends on the M1 Agent Runtime, recovery and cost contracts from #110/#114/#115, the M2 pull request is stacked on the cleaned M1 branch. Basing it directly on `origin/main` would duplicate unverified M1 work and is therefore explicitly rejected.

## M2 commits moved out of M1

- `8af3180` `feat(batch): 实现批量任务层级与 DAG 计划器`
- `ded7658` `feat(batch): 实现批量执行暂停恢复与失败隔离`
- `6a8fd17` `docs(m2): 记录批量编排包签收矩阵与剩余闸门`
- `4936944` `docs(m2): 记录 M2-03 依赖按代码完成状态收口`
- `d6f6842` `fix(batch): 修复批量执行并发调度`
- `a52d687` `fix(batch): 修复跨租户全局并发计数`
- `1fc60b9` `fix(batch): 修复重启恢复与单 tick 调度`
- `70a35c9` `fix(batch): 阻止 batch_tick 自循环`
- `bd96483` `fix(batch): 补齐容量等待与恢复 tick 闭环`
- `8b81948` `perf(db): 加速批量计划分页`

## Removed from M1

- API: `apps/api/src/batch-plan/**`, `BatchPlanModule` registration.
- Worker: `apps/worker/src/batch-plan/**`, `batch_tick` queue routing and child completion handling.
- Core and contracts: batch DAG planner, execution state machine, `BATCH_TICK_JOB`, batch plan schemas and tests.
- Database: `job_work_items`, M2-only `jobs` columns/constraints and migrations 0043, 0044 and 0045.
- Tests: `batch-plan.integration.test.ts`, contract and core batch tests.
- Docs: `m2-01a-batch-plan.md`, `m2-01b-batch-execution.md`, `m2-01-batch-orchestration-closeout.md` and `m2-03-dependency-acceptance.md`.

## Shared M1 foundation retained

- `7d44f00` remains in M1 because #114/#115 require provider-call budget enforcement, atomic cost settlement and recoverable job pauses for single-chapter generation and writing actions.
- Agent Runtime, checkpoints, `cost_reservations`, model-call provenance and recovery APIs remain M1 contracts.
- Batch plans consume these contracts; they do not define them.

## Verification

- `pnpm --filter @novel-brain/api typecheck`
- `pnpm --filter @novel-brain/worker typecheck`
- `pnpm --filter @novel-brain/web typecheck`
- `pnpm --filter @novel-brain/db db:generate` reports no schema changes after the split.
- M1 full `check`, integration, Playwright, parity and readiness are rerun before merge.
