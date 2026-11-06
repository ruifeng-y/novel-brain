# M1-05g 幂等执行、检查点、重试与人工恢复

> Ticket: #115. Primary capability: AGENT-011.

## 1. 交付范围

- `@novel-brain/contracts`：版本化 `GenerationCheckpoint`、输出引用、人工恢复请求/记录契约，以及恢复相关错误码。
- `@novel-brain/core`：从首个未成功步骤恢复、可重试故障的指数退避、终态/人工恢复策略与输出引用提取。
- `@novel-brain/db`：新增 `job_step_attempts`、`job_recoveries`，扩展 `jobs.checkpoint_version`、`job_steps.output_refs` 与 `job_checkpoints` 的 schema/revision/inputHash/outputRefs/error 字段；旧 checkpoint 回填为 v1。
- `apps/worker`：生成 Worker 与 Agent Orchestrator 共用持久化 checkpoint 语义；Worker 重启从最后成功步骤继续，模型调用中途中断时释放遗留预留。
- `apps/api`：新增 `POST /works/:workId/branches/:branchId/jobs/:jobId/recover`；owner 权限校验、checkpoint 版本冲突保护、恢复记录与 Change/Audit 账本写入。

## 2. 不变量

- checkpoint 单调递增 `revision`，`job_checkpoints(job_id, revision)` 唯一；旧格式按 v1 读取，未来 schema 版本显式拒绝。
- 每个 step attempt 持久化输入哈希、状态、错误与输出引用；已成功步骤不会因重试或重启再次执行。
- `timeout`、`rate_limit`、`provider` 最多自动重试 3 次，按 1s/2s/4s 指数退避；`budget`、`policy`、`schema`、`cancelled`、`unknown` 进入人工恢复。
- Worker 启动同一 step 的新 attempt 前，将遗留的 `started` 模型调用与 `reserved` 预留标记为中断并释放，避免卡住预算或重复结算。
- 人工恢复只允许任务 owner；恢复写入 `job_recoveries` 与 `audit_logs`，同一幂等键重复请求返回原恢复记录。
- 章节版本、上下文包、事实提案与成本结算仍走既有幂等入口；恢复不会复制已完成步骤的副作用。

## 3. 迁移

- `packages/db/migrations/0031_recovery_protocol.sql`
- 旧 `job_checkpoints` 按创建顺序回填 revision，并同步 `jobs.checkpoint_version` 与旧 `jobs.checkpoint` JSON。
- 旧 `job_steps` 的 attempts 回填到 `job_step_attempts`。
- `job_step_attempts` 与 `job_recoveries` 启用 `FORCE ROW LEVEL SECURITY` 与租户策略。

## 4. 证据

- 契约：`packages/contracts/test/recovery.test.ts`
- 策略：`packages/core/test/recovery.test.ts`
- 集成：`apps/api/test/generation.integration.test.ts`
  - 每个 step 边界注入 Worker crash，最终恢复且章节版本 2 个、上下文包 1 个、3 次成本结算、job token 与 usage 汇总一致
  - provider 429 自动退避后成功，仅成功 attempt 结算
  - 模型调用中途中断后释放旧预留，新 attempt 正常结算
  - 取消后人工恢复、checkpoint 版本冲突、跨租户拒绝、恢复记录/审计幂等
- 编排器回归：`apps/api/test/agent-orchestrator.integration.test.ts`

## 5. 命令

```bash
pnpm build:packages
pnpm vitest run packages/contracts/test/recovery.test.ts packages/core/test/recovery.test.ts
pnpm vitest run --config vitest.integration.config.mts apps/api/test/generation.integration.test.ts
pnpm vitest run --config vitest.integration.config.mts apps/api/test/agent-orchestrator.integration.test.ts
pnpm --filter @novel-brain/api openapi:generate
pnpm check
```
