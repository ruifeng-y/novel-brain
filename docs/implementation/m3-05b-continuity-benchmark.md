# M3-05b 跨卷叙事连续性基准

> Issue: #138
> Capability: CONT-001
> Status: implementation complete; automated full and maximum fixture evidence recorded; #239 records human raw scores as complete-with-warnings, while clean-packet review, adjudication, quality-threshold and variance decisions remain blocked.

## 实现范围

新增独立 `@novel-brain/continuity-benchmark` 包，不执行数据库 mutation，也不把容量测试当作叙事正确性证据。

- `createContinuityPlan` 固定 generator/schema/rubric 版本、seed、3,000/3,500/4,000 章拓扑、30/35/40 卷和早/中/晚分支点。
- `generateContinuityFixture` 生成确定性 story bible、题材包、世界规则、五级大纲、chapter/branch snapshots、objective facts、knowledge/belief/suspicion/misbelief/unknown states、canon/decision/disclosure 状态、body/identity/power/lifespan transitions、独立 item rights 历史、timeline/map hierarchy、plot/foreshadow/style/arc samples、seeded defects、clean controls 和 bounded-agent scenarios。
- Fixture 包含仙侠、历史、都市三类题材场景；能力寿命同时覆盖 realm-bound 与 age-only 世界。
- `workId` 与可解析 `eventManifest` 为事实、状态和身份转移提供显式 ground-truth event。
- `evaluateContinuityFindings` 输出 TP/FP/FN/TN、precision/recall，并按 family、severity、volume、branch 分组。
- Finding 必须精确链接 family、severity、branch、chapter、source fact、affected entity 和 version node；evidence 必须是引用章节中可验证的原文 span。
- P0 fact loss 与 knowledge-boundary false negative 为零时才通过自动连续性门禁。
- `buildContinuityBlindReviewPacket` 按早/中/晚卷分层，每个 stratum 混合 defect、clean/no-defect 与 incomplete-context escalate 样本；盲评包不暴露 oracle、control 或模型身份，也不在正文写入缺陷标记。
- `buildContinuityBenchmarkReport` 要求 two-or-more human reviewers、逐样本 rubric/confidence/evidence、approved sample count、adjudication、inter-rater agreement threshold 和 narrative evidence，才设置 `continuityReady=true`。
- Fixture、evaluation、blind packet 与 oracle 均带可重算 SHA-256；fixture hash 覆盖 `sourceCommit`。

## Full-scale 证据

证据绑定实现提交 `38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca`，seed `20261118`，生成产物位于 ignored `artifacts/quality/continuity/full/`。

- Canonical topology：3,500 章 / 35 卷 / 4 branches / 12 branch chapter snapshots。
- Full fixture file SHA-256：`3BF42FDEC58C23B1E8DF9D31BAFEB646B7A2E8FA39F4779AE318E279360CAD65`。
- Fixture digest：`2b66c641e0b6d3dc22761cea00e246ed5f34c8fd32488d51b15e4327a47da319`。
- 两次独立生成得到相同 file SHA-256，证明 seed/source commit 可复现。
- Ground truth：7,176 outline nodes、15 facts、11 knowledge states、9 identity transitions、24 defects、12 controls、36 Agent scenarios、41 events、3 genre scenarios。
- Evaluator：TP `24`、FP `0`、FN `0`、TN `12`，precision `1`、recall `1`；P0 false negatives `0`，knowledge-boundary false negatives `0`。
- Evaluation fixture SHA-256：`2b66c641e0b6d3dc22761cea00e246ed5f34c8fd32488d51b15e4327a47da319`；findings SHA-256：`b83d2215af5cf6026932ae3f87972a55f8e96df5275e1ad89d456e231f1c204d`；evaluation SHA-256：`a05ae51cf9f527c5cc6fb5b51e2d22c3281e013e297e783d7efd11ee4d1e524d`。
- Blind review：6 items，early/middle/late 各 2；其中 defect `3`、clean no-defect `2`、incomplete-context escalate `1`；leaked defect markers `0`。
- Blind packet SHA-256：`b1616e7177c5aa9310ca73954162e29b5cf0c866f31501f29099585439eeeb35`；oracle SHA-256：`1d4bb3056aa03f69a1e8552c5d21e929d2a787b4fd41cab0b50899a67ca48983`。
- Final report 按预期保持 `blocked`：`blind-review-evidence-missing`、`decision-required:blindReviewSamplesPerStratum`、`decision-required:interRaterAgreementThreshold`、`narrative-evidence-missing`。

Maximum boundary evidence 同样绑定 `38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca`：

- 4,000 章 / 40 卷。
- Fixture file SHA-256：`E967CBC7D0DE5546573D95CB8675244595D1D888E5191D0406F90887A9B78BC9`。
- Fixture digest：`e07ff595bb30840c0c3897ac91f6e48023819b58873ab4b72f33bc8e088afe1b`。

## Commands

```powershell
pnpm continuity plan --seed 20261118 --tier full --output artifacts/quality/continuity/full/plan.json
pnpm continuity generate --seed 20261118 --tier full --source-commit <sha> --output artifacts/quality/continuity/full/fixture.json
pnpm continuity evaluate --fixture artifacts/quality/continuity/full/fixture.json --findings findings.json --output artifacts/quality/continuity/full/evaluation.json
pnpm continuity review-plan --fixture artifacts/quality/continuity/full/fixture.json --samples-per-stratum <approved-count-at-least-2> --packet-output artifacts/quality/continuity/full/blind-review-packet.json --oracle-output artifacts/quality/continuity/full/blind-review-oracle.json
pnpm continuity report --fixture artifacts/quality/continuity/full/fixture.json --evaluation artifacts/quality/continuity/full/evaluation.json --review-packet artifacts/quality/continuity/full/blind-review-packet.json --review-oracle artifacts/quality/continuity/full/blind-review-oracle.json --review-evidence review-evidence.json --narrative-evidence narrative-evidence.json --decisions decisions.json --output artifacts/quality/continuity/full/report.json
```

## 验证

- Continuity package：`8` test files / `41` tests passed。
- Full repository：`104` test files / `523` tests passed。
- Full repository typecheck、ESLint、Prettier、`pnpm test:guardrails`、`pnpm check:pr`、`pnpm check:migrations` passed。
- Final two-axis code review blocking findings were resolved and re-checked; remaining fixture file-size refactor suggestions are non-blocking and do not alter evidence claims.

## 验证边界

- Human blind-review sample count 与 inter-rater agreement threshold 仍是 decision-required；实现不自行发明通过阈值。
- #239 已在 `docs/quality/evidence/m3-239/` 归档原始评分为 `complete-with-warnings`；两名评审人共同标记 24 个缺陷元信息样本待裁决，`hook_prose_score` 也低于 4/5，因此 narrative-quality claim 仍为 blocked。
- Narrative outline adherence、hook/prose score 和 continuity-conflict rate 必须由有来源的证据提交，不能用生成包自证。
- 真实人工盲评已由 #239 归档；approved decisions 和 #139 固定质量 registry 消费仍保持独立，不在本票伪造完成。
- 容量与恢复由 #137 独立负责；通过本 benchmark 不代表容量达标。
