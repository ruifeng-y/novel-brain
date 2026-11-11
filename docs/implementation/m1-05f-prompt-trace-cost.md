# M1-05f Prompt/模型来源、轨迹与成本账本

> Ticket: #114. Primary capabilities: AGENT-009, AGENT-010.

## 1. 交付范围

- `@novel-brain/contracts`：`PromptVersion`、`ModelCall`、`CostReservation`、`AgentRunTrace`、失败分类与回放元数据严格 Zod schema。
- `@novel-brain/db`：新增 `prompt_versions`、`cost_reservations`、`model_calls`，扩展 `agent_runs`；启用租户隔离 RLS。
- `@novel-brain/db`：`CostLedger` 在任务行锁内原子预留预算，调用后幂等结算，失败释放；并发预留不会超支，重复结算不会重复扣费。
- `apps/worker`：每次模型调用记录提示版本哈希、模型/参数/配置哈希、输入输出摘要哈希、token、费用、耗时、供应商响应 ID 和失败分类。
- `apps/api`：新增 `GET /works/:workId/branches/:branchId/agent-runs` 与 `GET .../agent-runs/:runId`，按 work/branch/chapter/job 查询轨迹并返回可回放配置/版本元数据。
- `apps/web`：写作台展示生成记录、调用次数、模型、用量、费用、失败分类与人工升级原因，不展示提示词、正文或密钥。
- `@novel-brain/ai`：区分 `provider`、`timeout`、`rate_limit`、`schema`、`policy`、`budget`、`cancelled`、`unknown` 失败。
- `@novel-brain/core`：普通日志载荷脱敏与敏感值扫描。

## 2. 成本语义

与 ADR 0021 对齐：

1. 模型调用前预留预算，预留与调用同属一个不可分割的执行边界。
2. 调用成功后在任务行锁内按实际 token/费用结算，只累加一次。
3. 调用失败释放预留，不产生任务费用。
4. 超预算在调用前硬停，保留已有草稿、检查点和已结算费用。
5. 同一幂等键重复结算返回原结果；不同实际用量重复结算会显式冲突。

## 3. 敏感数据

- 轨迹只保存提示词哈希、系统提示哈希、输入输出摘要哈希和字节数，不通过轨迹 API 返回提示词、完整上下文、正文或 Key。
- Worker 正常日志只包含 `jobId`、`runId`、`modelCallId`、`reservationId`、步骤、token、费用、耗时和失败分类。
- `sanitizeLogPayload` 对 `apiKey`、`authorization`、`prompt`、`system`、`manuscript`、正文/上下文键及内嵌 `sk-*`/Bearer 凭证做脱敏。

## 4. 证据

- 契约：`packages/contracts/test/agent-trace.test.ts`
- 日志脱敏：`packages/core/test/logging.test.ts`
- 失败分类：`packages/ai/test/failure-class.test.ts`
- 集成：`apps/api/test/generation.integration.test.ts`
  - 轨迹按 job/chapter 查询、跨租户拒绝、回放元数据、ToolCall 关联
  - 并发预算预留、幂等结算、冲突结算
  - 限流失败分类、人工升级原因、释放预留
  - 日志扫描不含 Key、正文、提示词或完整上下文
- UI：`apps/web/e2e/parity/writing.spec.ts`
- 迁移：`packages/db/migrations/0029_cuddly_malcolm_colcord.sql`

## 5. 命令

```bash
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm vitest run --config vitest.integration.config.mts apps/api/test/generation.integration.test.ts
pnpm typecheck
pnpm check
pnpm exec playwright test apps/web/e2e/parity/writing.spec.ts
```
