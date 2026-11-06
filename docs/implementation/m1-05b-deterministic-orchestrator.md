# M1-05b 确定性 Orchestrator 与 Agent 状态机

> Ticket: #110. Primary capability: AGENT-002.

## 1. 交付范围

- `@novel-brain/contracts`：版本化 run/task/step 状态、Workflow Envelope、调度/暂停/恢复/取消/人工批准/升级/动态子任务命令，以及 append-only 事件和持久化运行状态。
- `@novel-brain/core`：确定性 DAG 校验、状态转移表、优先级选择、幂等命令、重复/乱序事件防护、暂停边界、取消、人工/高风险门禁和动态子任务约束。
- `@novel-brain/db`：复用 `jobs`、`job_steps`、`job_events`、`job_checkpoints`。`jobs` 增加 `priority` 和 `orchestration`，允许 `agent_workflow` 类型并支持非章节任务；没有新增第二套 job 状态机。
- `apps/worker/src/agent-runtime`：`AgentOrchestrator` 在调度前和每次任务执行前调用 #109 `AgentGrantGuard`，在每个工具调用前再次授权并预占预算。
- `apps/api/test`：真实 PostgreSQL/Redis 集成测试覆盖幂等调度、越权 Grant、Worker 重启、暂停/恢复/取消、人工升级和撤销后的执行拒绝。

## 2. 不变量

- run 状态使用 M0 job 状态枚举；事件按 `sequence` 连续应用，重复、过期和乱序事件不会制造第二次状态转移。
- `schedule` 使用 workflow idempotency key 唯一约束，同一键只产生一个逻辑 run。
- 环、未知依赖、重复任务、任务数/深度/fan-out/并发/预算、非法工具、角色越权和人工门禁问题在调度前拒绝。
- 高风险任务和人工工具必须经过作者批准；Agent 只能升级，不能批准。
- 暂停在当前 step 结束后生效；恢复从持久化 checkpoint 继续；取消保留已完成步骤并取消剩余工作。
- 动态子任务只能扩展预授权 Envelope，并重新执行 DAG、预算、深度、fan-out、并发和 Grant 校验。
- PostgreSQL 是 run/task/step 与事件的持久真源；`job_steps` 是现有 step 状态的唯一投影。

## 3. 证据

- `packages/contracts/test/orchestrator.test.ts`
- `packages/core/test/orchestrator.test.ts`
- `apps/api/test/agent-orchestrator.integration.test.ts`
- 迁移：`packages/db/migrations/0026_stormy_molly_hayes.sql`
