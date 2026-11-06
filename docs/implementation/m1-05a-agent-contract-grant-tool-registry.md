# M1-05a Agent Contract、Grant 与 Tool Registry

> Ticket: #109. Primary capabilities: AGENT-001, AGENT-003.

## 1. 交付范围

- `@novel-brain/contracts`：Agent Contract、角色、失败语义、Tool Registry 条目、Agent Grant、工具调用请求与响应契约全部为 strict Zod schema。
- `@novel-brain/core`：Tool Registry、S0–S4 副作用分级、角色工具能力表、确定性 allow/deny 策略、JSON Schema 输入/输出校验。
- `@novel-brain/db`：`agent_grants`、`agent_tool_calls`，带租户键、约束、索引和 `FORCE ROW LEVEL SECURITY`。
- `apps/api/src/agent-runtime`：作者会话可签发、读取、撤销 Grant；没有 PATCH 或代理委托入口。
- `apps/worker/src/agent-runtime`：`AgentGrantGuard` 提供出队派发前与每次工具调用前的重验边界。

不包含 Orchestrator、ContextPack 或模型 prompt。Grant 的执行接入由 #110 完成。

## 2. 角色与工具

角色固定为 `planner`、`context_curator`、`writer`、`critic`、`reviser`、`fact_extractor`、`canon_curator`。Agent Contract 只能声明对应角色允许的工具，未注册或越权的工具在校验阶段拒绝。

Tool Registry 固定分级：

| 等级 | 含义 | 当前工具 |
| --- | --- | --- |
| S0 | 只读，无副作用 | `context.read_pack`、`canon.read_confirmed`、`chapter.read_brief` |
| S1 | 可回滚的草稿或评审写入 | `draft.write_version`、`review.report_finding` |
| S2 | 只产生候选，不改变权威事实 | `fact.propose`、`canon.propose_commit` |
| S3 | 权威正史写入，必须人工确认 | `canon.commit` |
| S4 | 不可逆或外部副作用，只允许作者本人 | `export.work_bundle` |

策略按顺序检查：Grant 未撤销/未过期、租户/作品/分支/任务绑定、工具已注册、代理可调用、角色能力、Grant 白名单、副作用上限、人工确认、资源范围、影响资源数、成本/token/调用次数预算。S4 始终拒绝代理调用。

## 3. Grant 不可传递与不可提升

- Grant 没有父 Grant、委托字段或子 Grant 关系。
- Agent Contract 与 Grant 均拒绝未知字段；请求不能自带 `userId`、`issuedBy`、已花预算或委托信息。
- 只有已认证作者会话可签发/撤销 Grant；Agent 没有签发入口。
- 不存在 Grant 更新接口，因此不能在原 Grant 上扩权；重新签发需要作者显式创建新 Grant。
- 工具 Registry 不包含任何 Grant 管理工具。
- 每次策略判断都使用当前 Grant 记录，不能复用旧快照或过期 Grant。

## 4. 执行边界

### 队列派发

`AgentGrantGuard.assertDispatch` 在任务出队、真正开始执行前重新读取 Grant，并校验撤销、过期与 work/branch/task 绑定。检查结果写入 `audit_logs` 的 `agent_grant.dispatch_check`。

### 运行中的每次工具调用

`AgentGrantGuard.authorizeToolCall` 在每次工具调用前重新读取 Grant，并在同一数据库事务中：

1. `SELECT ... FOR UPDATE` 锁定 Grant 行；
2. 用当前时间重新执行 allow/deny 策略；
3. allow 时原子预占成本、token 和调用次数；
4. 写入 `agent_tool_calls` 与 `audit_logs`。

撤销操作也锁定同一 Grant 行，因此撤销与工具授权串行化。撤销提交后，下一次派发检查或工具调用必然拒绝；已经授权通过的单个工具调用不会被回滚，这是明确的执行边界。

### 审计与敏感数据

`agent_tool_calls` 只保存输入 hash、输入键名和字节数、资源引用、副作用等级、决策与估算预算，不保存正文、prompt 或上下文包原文。`audit_logs` 记录 Grant 签发、撤销、派发检查和工具调用决策。

## 5. API

作者会话路由：

- `POST /api/v1/works/:workId/branches/:branchId/agent-grants`
- `GET /api/v1/works/:workId/branches/:branchId/agent-grants`
- `GET /api/v1/works/:workId/branches/:branchId/agent-grants/:grantId`
- `POST /api/v1/works/:workId/branches/:branchId/agent-grants/:grantId/revoke`

所有查询和写入同时约束 `user_id`、`work_id`、`branch_id`。跨租户访问返回 `FORBIDDEN_TENANT_ACCESS`。

## 6. 证据

- `packages/contracts/test/agent-runtime.test.ts`：strict 字段、Grant 形状、撤销证据、工具调用资源。
- `packages/core/test/agent-runtime.test.ts`：S0–S4 表驱动 allow/deny 矩阵、角色越权、未注册工具、过期/撤销、预算、资源范围、JSON Schema 输出校验。
- `apps/api/test/agent-runtime.integration.test.ts`：签发/读取/撤销、跨租户、未注册工具、审计、RLS、队列派发撤销、运行中撤销、预算耗尽。

## 7. 后续接口

- #110 必须在任务出队和每次工具调用处调用 `AgentGrantGuard`，不得用队列 payload 中的旧 Grant 快照替代数据库重验。
- #114 负责成本结算与并发预算竞争；本 ticket 在授权时做保守预占。
