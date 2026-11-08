# M2-03 依赖验收记录

> 日期：2026-11-07
> 范围：#149、#150 的实现前置合同
> 性质：**实现时序决策，不替代父包/视觉/golden 签收**

## 1. 决策

`#149`、`#150` 可以按以下代码完成状态开始实现，但 tracker 中已存在的 blocked-by 边暂不删除：

- `#91`：后端/Worker 包已由 `#151`、`#152` 完成；`#91` 保持打开，仅因 Batch 页面、审核队列、成本报告和 `#97` parity 尚未完成。对 `#149/#150` 的 DAG、工作项、暂停恢复和检查点合同，接受为可用。
- `#114/#115`：Prompt/模型来源、成本账本、检查点、重试和人工恢复合同已实现并有集成证据；票据保持打开仅因 M1 包级签收未关闭。
- `#117/#147`：Critic/Finding、黄金三章候选/评审/锁定合同已实现并有测试；票据保持打开仅因 M1 页面 golden/作者视觉签收未完成。

## 2. 证据

- #91：`docs/implementation/m2-01-batch-orchestration-closeout.md`
- #114：`docs/implementation/m1-05f-prompt-trace-cost.md`
- #115：`docs/implementation/m1-05g-idempotent-recovery.md`
- #117：`docs/implementation/m1-117-quality-critic.md`
- #147：`docs/implementation/m1-04a-golden-three.md`

## 3. 约束

- 本记录不关闭 `#91/#114/#115/#117/#147`，也不把它们标为 `parity-verified`。
- `#149` 必须复用 #117 Finding/风险分类和 #147 黄金三章门禁，不另建审批状态机。
- `#150` 必须复用 #114 `CostLedger` 和 #115 检查点/恢复语义，不另建成本账本。
- Batch 页面最终仍由 `#97` 和 `#93` 的 UI/parity 验收；`#91` 在页面验收完成前保持打开。

## 4. 下一步

在新上下文中执行 `/implement #149`，完成审核队列、批量低风险审核、自动通过谓词、权限/审计和并发审批测试；随后执行 `/implement #150`。
