# M2-01 批量任务 DAG、工作项与 Agent 运行边界签收

> Package：#91
> Children：#151、#152
> 日期：2026-11-07
> 结论：**后端/Worker 包实现完成；父包仍受 Batch UI 与审批/成本集成闸门阻挡，暂不关闭。**

## 0. 分支与依赖

- Scope split：#164。
- M1 base：`codex/m1-full-loop` 的 batch-free 验收树。
- M2 branch：`codex/m2-batch-isolation`。
- #91 依赖 M1 #110/#114/#115 的 Agent Runtime、成本与恢复契约，因此本分支是 stacked branch；PR 以清理后的 M1 分支为 base，不直接以 `origin/main` 为 base 重复夹带 M1 工作。
- 原 M2 0043–0045 已合并为基于 M1 `0046_gorgeous_epoch` 之后的 `0047_remarkable_krista_starr.sql`，避免分叉迁移链。
- 拆分前后提交、文件、迁移与共享依赖清单见 `m1-m2-scope-split.md`。

## 1. 验收矩阵

| #91 验收项 | 证据 | 状态 |
| --- | --- | --- |
| 全书/卷/章/步 DAG 与稳定工作项 key 覆盖 3,000–4,000 章 | #151：`packages/core/src/batch-plan.ts`、`packages/core/test/batch-plan.test.ts`、`apps/api/test/batch-plan.integration.test.ts` | 已满足 |
| 调度遵守 global/per-work/per-user 并发与交互优先 | #151：`packages/core/src/batch-plan.ts` 调度选择、`packages/core/test/batch-plan.test.ts`、`docs/implementation/m2-01a-batch-plan.md` | 已满足 |
| 暂停/恢复/取消/重试/失败隔离可重启且幂等 | #152：`packages/core/src/batch-execution.ts`、`apps/worker/src/batch-plan/*`、`apps/api/test/batch-plan.integration.test.ts`、`docs/implementation/m2-01b-batch-execution.md` | 已满足 |
| Agent 任务扩展由 #110 校验授权、预算、fan-out/depth 和 DAG | 复用 #110 `orchestrator` 契约与 `apps/api/test/agent-orchestrator.integration.test.ts`；#151/#152 没有另建 Agent 状态机 | 已满足（组合现有契约） |
| Batch UI 展示真实父子进度、失败证据和检查点 | Batch 页面仍为 `production-pending`；审核队列/成本/通知分别依赖 #149/#150/#97 | **未满足** |

## 2. 叶子票据状态

- #151 批量任务层级、卷章工作项与 DAG 计划器：已完成并提交 `8af3180`。
- #152 批量工作项执行、暂停恢复与失败隔离：已完成并提交 `ded7658`。
- 两张叶子均已通过 `pnpm check`、全量集成测试和 code review；可以关闭。

## 3. 父包阻塞项

- Batch 页面需要展示父计划、卷、章工作项、步骤检查点、失败章节和审核队列；当前 Web 尚无该页面的生产实现。
- 审核队列与自动通过谓词由 #149 负责；成本硬停/报告由 #150 负责；通知与 M2 页面 parity 由 #97 负责。
- 因此 #91 不能仅凭 API/Worker 证据关闭；否则会绕过原型 parity 和真实页面动作要求。

## 4. 后续前沿

1. 关闭 #151/#152。
2. 处理 #149 与 #150 的后端契约和测试；二者在 tracker 中仍受 #91/#117/#147、#91/#114/#115 的 issue 状态阻挡，需要先接受 M1 代码完成但票据未关闭的现状，或补齐 M1 父包签收。
3. 完成 #149/#150 后实现 Batch 页面状态和 #97 的 M2 页面 parity，再关闭 #91/#93/#97。

## 5. 验证命令

```bash
pnpm check
pnpm test:integration
node scripts/validate-readiness.mjs
```
