# M3-06a 固定质量基准集、评分 Rubric 与回归门禁

> Issue: #139
> Capabilities: QUALITY-006, EVAL-001, EVAL-002
> Status: implementation complete; automated registry/execution/regression evidence recorded; human raw scores are archived in #239, while pending adjudication, the failed hook/prose threshold and unapproved variance threshold keep release use blocked.

## 实现范围

新增独立 `@novel-brain/quality-benchmark` 包，作为 file-backed release Eval registry 和 CLI gate。它不调用真实 provider，也不把 model self-score 或生成样本冒充人工盲评。

- 固定 release dataset：3 个题材各 60 个 chapter samples，共 180 个；另有 24 个来自 #138 full fixture 的 long-horizon adversarial cases。
- Dataset manifest 固定 sample id、genre、difficulty、source version/hash、known issues、continuity fixture hash 和 dataset SHA-256。
- Release rubric 固定 ADR 0022 的五个初始门槛、证据要求、scorer type、score range、variance decision、waiver owner 和 rubric SHA-256。
- `executeQualityBenchmarkCandidate` 重新生成 #138 fixture，真实运行 `evaluateContinuityFindings`，从 execution result 生成 P0、knowledge-boundary 和 continuity-conflict 指标。
- `evaluateQualityBenchmarkRun` 只使用 approved dataset/rubric；校验 continuity evaluation digest、fixture hash、human scorer coverage、reviewer attestation、blind-packet hash、confidence、evidence span、required outline beats、重复 scorer record 和 score range。
- Continuity evaluation 会从 run 内保留的 raw findings 和 pinned fixture 重算；自洽但伪造的 evaluation 不能通过。
- Inter-rater variance threshold 只接受调用边界提供的 reviewed policy；candidate 内嵌 decisions 不再能解除门槛。
- Report 内嵌 `runId`、全部逐样本 scores、decisions、raw continuity findings、continuity evaluation、provenance 和 report SHA-256。
- Report verification 会使用外部 review policy、approved dataset/rubric 及 report 内嵌证据重算，拒绝缺指标、伪造 metric、伪造 threshold 或自洽但不可复现的 report。
- `compareQualityBenchmarkRuns` 要求 baseline/candidate 使用相同且 approved 的 dataset/rubric；candidate gate 失败、P0 指标缺失、baseline/candidate 为同一 report 或 P0 增加时拒绝 rollout。
- `evaluate` 与 `regress` 返回 non-zero process exit code，可用于 CI/release gate。
- CLI `evaluate/regress` 通过独立 `--review-policy` artifact 接收可信策略；不提供时保持 blocked。
- 新增内部 Nest `EvalModule`：`EvalService.run/gate` 调用 approved package execution，并允许内部调用边界单独传入 reviewed policy。`EvalRepository` 在 tenant context 下持久化 case、run、逐 score 和 gate 结果。Run key 绑定完整 candidate artifact，避免同 `candidateId` 的不同 provenance 误复用旧 report。
- Run 写入使用原子 `on conflict do nothing` + 读取胜出记录，消除并发相同 run 的 check-then-insert 竞态。
- 新增 `eval_cases`、`eval_runs`、`eval_scores`、`eval_gates`；run/score/gate 强制 RLS，`eval_cases` 保存冻结的全局 benchmark 样本元数据。
- `eval_scores.run_id` 与 `eval_gates.baseline_run_id/candidate_run_id` 使用带 `user_id` 的复合外键，阻止跨 tenant 引用。
- Human score 持久化 `evidence_quotes`、`reviewer_attestation_id`、`reviewed_at` 与 `blind_packet_sha256`。
- `eval_runs` 持久化 raw `continuity_findings` 供审计重放。
- 数据库迁移：`packages/db/migrations/0069_broken_triton.sql`、`0070_military_mindworm.sql`、`0071_old_sinister_six.sql`、`0072_chunky_iron_patriot.sql`、`0073_rich_stellaris.sql`。

## Frozen registry

- Seed：`20261118`
- Fixture source commit：`38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca`
- Continuity tier：`full`
- Dataset SHA-256：`90c8c8c44540ae99246e243ac16c1158d7cee3485ac4b5c1a901b3b7164e753b`
- Continuity fixture SHA-256：`2b66c641e0b6d3dc22761cea00e246ed5f34c8fd32488d51b15e4327a47da319`
- Rubric SHA-256：`247a1fcc0c0ce58bca7faa8a93a8b0d0e39c4095fc2f1c5748767b53d6fc1b3b`
- Dataset snapshot：`docs/quality/quality-benchmark-v1.dataset.json`
- Manifest snapshot：`docs/quality/quality-benchmark-v1.manifest.json`
- Rubric snapshot：`docs/quality/quality-benchmark-v1.rubric.json`

Registry tests compare all three frozen artifacts against the runtime approved generator/rubric. Any dataset/rubric change that is not deliberately versioned and re-approved fails `dataset-not-approved` or `rubric-not-approved`.

## Commands

```powershell
pnpm quality dataset --output artifacts/quality/benchmark/dataset.json
pnpm quality rubric --output artifacts/quality/benchmark/rubric.json
pnpm quality execute --dataset docs/quality/quality-benchmark-v1.dataset.json --rubric docs/quality/quality-benchmark-v1.rubric.json --candidate candidate.json --output artifacts/quality/benchmark/run.json
pnpm quality evaluate --dataset docs/quality/quality-benchmark-v1.dataset.json --rubric docs/quality/quality-benchmark-v1.rubric.json --run artifacts/quality/benchmark/run.json --output artifacts/quality/benchmark/report.json
pnpm quality regress --baseline baseline-report.json --candidate artifacts/quality/benchmark/report.json --output artifacts/quality/benchmark/regression.json
```

`quality evaluate` exits non-zero when the candidate report is blocked. `quality regress` exits non-zero when rollout is not allowed.

## 验证

- Quality benchmark package：7 test files / 29 tests passed。
- API `EvalService`：真实执行 approved benchmark 后再调用持久化 seam。
- PostgreSQL `Eval` integration：run/score/gate 原子持久化、并发 run key 去重、复合外键拒绝跨 tenant 引用、跨 tenant 不可见；RLS 断言使用 `NOSUPERUSER NOBYPASSRLS` role。
- Covers deterministic registry, #138 execution integration, model-only rejection, missing human evidence, confidence/evidence validation, duplicate score rejection, ADR threshold failures, report integrity, frozen snapshot consistency and P0 regression.
- Full repository typecheck, lint, format, tests and executable guardrails are rerun before PR merge.

## 发布边界

- Automated tests intentionally use clearly labeled synthetic reviewer records to verify the gate implementation; they are not release blind-review evidence.
- Human review has supplied two reviewers per sample, required outline-beat evidence, consistent reviewer attestations and both the evaluator gate hash and actual packet hash; see `docs/implementation/m3-239-human-blind-review.md`.
- Both reviewers flagged the same 24 long-horizon cases for adjudication; no adjudication result is recorded, so #239 remains open.
- The recorded `hook_prose_score` is `1.882353`, below the required `4/5`; `interRaterVarianceThreshold` still requires the separate #240 decision.
- The current gate blocks model-only judgement and any non-approved dataset/rubric artifact.
- Real DeepSeek provider smoke, canary and rollback remain #140.
- 10M capacity/performance remains #137.
