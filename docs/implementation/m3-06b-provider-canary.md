# M3-06b 真实模型 Smoke、灰度与回滚策略

> Issue: #140
> Capabilities: EVAL-003, EVAL-004
> Status: protected real-provider smoke passed; canary release use remains blocked by model alias alignment, quality approval and final V1 gates.

## 决策

- Canary 只面向显式的内部 release cohort，不把真实作者作品流量切入未批准配置。
- 自动阻断条件为零容忍：provider smoke 失败、版本不匹配、预算/延迟/重试越界、质量 gate 失败或 P0 regression 任一出现即 blocked。
- Rollback 只恢复上一份 approved release pin，并追加新的 rollback decision；不更新历史 model call、生成结果或发布 metadata。

## 真实 Provider Smoke

- `runDeepSeekSmoke` 只有同时设置 `DEEPSEEK_SMOKE_ENABLED=1` 和 `DEEPSEEK_API_KEY` 才会访问网络。
- Smoke 的 Base URL 必须通过共享 SSRF/allowlist 校验；DeepSeek 只允许官方 HTTPS endpoint，危险或非公开地址在网络调用前失败。
- 每次真实 Provider 调用都会再次执行共享 endpoint 校验，并把请求固定到已验证的公开 IP；TLS SNI/Host 仍使用原始域名，持久化 release evidence 不能绕过 HTTPS、DeepSeek 官方 endpoint、DNS rebinding、私网或 redirect 限制。
- 预算上限由 `DEEPSEEK_SMOKE_MAX_BUDGET_CNY` 控制，并在网络调用前按最大输出 token 估算成本。
- `DEEPSEEK_SMOKE_TIMEOUT_MS` 限制单次调用，`DEEPSEEK_SMOKE_MAX_ATTEMPTS` 上限为 3；仅 `rate_limit` 和 `provider` 失败可重试。
- Evidence 记录 schema、run、provider、model、prompt/context/agent/config 版本、配置与 prompt hash、请求 ID、token、成本、延迟、尝试次数和结果。
- Provider `finish_reason` 不是 `stop` 或正文为空时按失败记录，不能进入 canary。
- 已返回 usage 的非 `stop` 响应会记录实际 token 成本，并标记为不可重试，避免重复计费后把成本写成零。
- Evidence 不包含 API key、prompt 正文或生成正文，只记录正文 hash 与长度。
- `provider-smoke.yml` 仅支持 `workflow_dispatch`，使用 `provider-smoke` environment secret；普通 PR 和 push CI 不包含真实 provider 依赖。

## 当前 Gate 证据

- 2026-11-25：在提交 `11735fa1400963456fcbe8c95bd654468631d342` 上手动运行 [Provider Smoke 45557765302](https://github.com/ruifeng-y/novel-brain/actions/runs/45557765302)。
- 配置：DeepSeek 官方 HTTPS API、请求模型 `deepseek-chat`、响应模型 `deepseek-flash`、`m1-writing-prompts-v1`、最大预算 `0.01 CNY`。
- 结果：`succeeded`，`finishReason: stop`，`attempts: 1`，`networkCalls: 1`，46 tokens，约 `0.000092 CNY`，延迟 1000ms。
- 脱敏记录：`docs/implementation/evidence/m3-07e-01-provider-smoke-success-2026-11-25.json`。该证据不包含 Key、prompt 正文或生成正文。
- Provider 响应模型为 `deepseek-flash`，而 canary policy 的 pin 使用请求模型 `deepseek-chat`。当前比较器会产生 `smoke-model-mismatch`，因此 EVAL-004 保持 `implemented`，由 #271 完成模型身份映射或拒绝规则。
- 2026-11-25：在提交 `20ecf9bdc2874b8267c51395a26286ee03e7af8d` 上手动运行 [Provider Smoke 45469254950](https://github.com/ruifeng-y/novel-brain/actions/runs/45469254950)。
- 配置：DeepSeek 官方 HTTPS API、`deepseek-chat`、`m1-writing-prompts-v1`、最大预算 `0.01 CNY`。
- 结果：`failure` / `skipped` / `DEEPSEEK_API_KEY_MISSING`，`networkCalls: 0`。`provider-smoke` environment 存在，但 `protection_rules` 为空且未列出 `DEEPSEEK_API_KEY`。
- 随后在提交 `aad8e9da5e316ff901dc262fb431227e06302a9f` 上运行 [Provider Smoke 45552558049](https://github.com/ruifeng-y/novel-brain/actions/runs/45552558049)。审批后发起 1 次调用，但 Node 24 pinned lookup 的批量地址回调缺陷触发 `DEEPSEEK_PROVIDER_ERROR`；PR #270 修复后由最终成功 run 验证。

## Canary 与回滚

- `provider-canary-v1` policy 固定 channel、release version、内部 subject cohort、版本 pin、最大成本、延迟、尝试次数和 timeout。
- 本票的 release pin 固定为 DeepSeek 官方 endpoint；OpenAI-compatible Provider 不在本次灰度范围内。
- Policy pin 同时绑定 base URL、smoke prompt hash、writing prompt bundle hash；未进入 cohort 的生成使用 `m1-writing-prompts-v0`/`m1-context-v0`，pin 选择已注册的 v0/v1 prompt bundle 与 context compiler version。
- `m1-context-v0` 保留 legacy 的非 P0 候选分支来源兼容行为；`m1-context-v1` 要求所有非 P0 候选显式绑定当前 `branchId`，来源缺失时记录 `stale_branch` 淘汰。`P0` 硬约束不走该淘汰路径。
- 生产章节和写作动作使用同一 active release pin 选择 context version；`m1-context-v1` 还会在存在 fresh chapter summary 覆盖旧章节时淘汰重复的全文版本并记录 `summary_superseded`，`v0` 保持两种来源并存。
- Canary 决策强制读取同一租户的已持久化 quality gate，不接受调用方自报 regression；候选 provenance 必须匹配 policy pin。
- Decision evidence 持久化完整 policy 与 `limits`；quality provenance 必须包含并匹配 policy `configHash`，因此阈值和 quality run 所测配置都可从 append-only 记录重建。
- Active、rollback target 和 Worker pin 查询统一按 `createdAt + uuidv7 id` 倒序；同毫秒决策仍保持确定性，rollback 拒绝早于当前 decision 的时间。
- Cohort 按 subject ID 排序去重；重复 subject 会阻断。决策记录 `policySha256`、`cohortSha256`、smoke hash 和 quality regression hash。
- `eval_release_decisions` 是 append-only 的租户表，记录 action、status、版本 pin、前一条 decision 和 rollback target；数据库 trigger 拒绝普通 UPDATE/DELETE，仅允许 `app.system_role=account_deletion` 的账号清理通道删除，并通过自引用 cascade 处理清理顺序。
- Rollback 在同一事务中锁定 latest/current，只允许回滚当前 active decision，按 `createdAt` 严格早于 current 的 active target 并追加记录；唯一索引阻止同一 current 的并发重复 rollback。新增记录恢复上一份 active pin，并明确 `historicalMetadataMutated: false`。
- Worker 的 generation path 按 subject cohort 应用 active rollback pin，覆盖 provider/base URL/model，并按 release prompt version 选择实际 prompt bundle；model call 记录有效 provider/model/config hash 和 release pin，不改写历史 model call/report。Rollback 到 v0 pin 会恢复旧 prompt bundle/context version。
- API 预检/预览、generation、writing action 与 golden-three context compilation 从同一 active pin 读取 context version；模型调用受 pin 的 `maxCostCny`、`maxLatencyMs`、`maxAttempts` 与 `timeoutMs` 约束，越界在 Provider 调用前或调用边界 fail closed。
- 预算预留失败路径同样记录 effective provider/model/config hash、release prompt key 和 rollback pin，避免失败调用审计元数据退化。
- Release 决策消费已持久化 quality gate，不直接接受 candidate 自报 regression。

## 代码与数据

- `packages/quality-benchmark/src/canary.ts`
- `packages/ai/src/index.ts` 的真实 smoke seam
- `.github/workflows/provider-smoke.yml`
- `packages/db/migrations/0074_talented_thanos.sql`、`0075_true_dorian_gray.sql`、`0076_wise_juggernaut.sql`
- `apps/api/src/eval/eval.service.ts`：`canary`、`rollback`
- `apps/api/src/eval/eval.repository.ts`：append-only release decision 持久化与查询
- `apps/worker/src/generation/generation.repository.ts`：cohort release pin resolution

## 验证

- DeepSeek smoke：显式开关、无网络 skip、预算前置阻断、rate-limit 有界重试、失败脱敏、版本与证据字段。
- Canary：确定性 cohort、版本 mismatch、预算/延迟/attempt 越界、质量 gate 阻断和前一 approved pin 回滚。
- PostgreSQL integration：canary approved/blocked、rollback、RLS 跨租户不可见、复合外键拒绝跨租户引用。
- Workflow guardrail：manual-only、environment secret、no implicit CI provider call。

## 发布边界

- 受保护的真实 DeepSeek smoke 已成功；该结果不替代人工盲评、variance threshold 或最终 #104 Production CI。
- #137 的 10M 容量证据和 #104 的 V1 UI 全量签收仍独立。
