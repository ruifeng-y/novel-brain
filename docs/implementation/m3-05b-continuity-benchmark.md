# M3-05b 跨卷叙事连续性基准

> Issue: #138
> Capability: CONT-001
> Status: implementation complete; automated acceptance pending normal Production CI

## 实现范围

新增独立 `@novel-brain/continuity-benchmark` 包，不执行数据库 mutation，也不把容量测试当作叙事正确性证据。

- `createContinuityPlan` 固定 generator/schema/rubric 版本、seed、3,000/3,500/4,000 章拓扑、30/35/40 卷和早/中/晚分支点。
- `generateContinuityFixture` 生成确定性 chapters、volumes、branches、objective facts、knowledge/belief/suspicion/misbelief/unknown states、body/identity transitions、independent item rights、timeline/routes、plot/foreshadow/style samples、seeded defects 和 clean controls。
- Fixture 包含 bounded-agent scenarios，覆盖 `propose_repair`、`abstain`、`escalate`；所有 grant 均禁止 `submit_canon` 和 `grant_permission`。
- `evaluateContinuityFindings` 输出 TP/FP/FN/TN、precision/recall，并按 family、severity、volume position 和 branch 分组。
- P0 fact loss 与 knowledge-boundary false negative 为零时才通过自动连续性门禁。
- `buildContinuityBlindReviewPacket` 按早/中/晚分层抽样，盲评包不暴露 hidden truth、defect oracle 或模型身份；oracle 和 packet 使用独立 SHA-256。
- `buildContinuityBenchmarkReport` 要求人工盲评 evidence、至少两名 reviewer、批准后的 sample count 和 inter-rater agreement threshold，才设置 `continuityReady=true`。

## Commands

```powershell
pnpm continuity plan --seed 20261118 --tier full --output artifacts/quality/continuity/plan.json
pnpm continuity generate --seed 20261118 --tier full --source-commit <sha> --output artifacts/quality/continuity/fixture.json
pnpm continuity evaluate --fixture artifacts/quality/continuity/fixture.json --findings findings.json --output artifacts/quality/continuity/evaluation.json
pnpm continuity review-plan --fixture artifacts/quality/continuity/fixture.json --samples-per-stratum <approved-count> --packet-output artifacts/quality/continuity/blind-review-packet.json --oracle-output artifacts/quality/continuity/blind-review-oracle.json
pnpm continuity report --fixture artifacts/quality/continuity/fixture.json --evaluation artifacts/quality/continuity/evaluation.json --review-packet artifacts/quality/continuity/blind-review-packet.json --review-oracle artifacts/quality/continuity/blind-review-oracle.json --review-evidence review-evidence.json --decisions decisions.json --output artifacts/quality/continuity/report.json
```

## 验证边界

- 单元测试覆盖 plan、fixture determinism、知识边界、独立物品权利、bounded-agent scenarios、evaluator metrics、盲评分层和 release gate。
- Full fixture 可在 CI 或授权本地环境按需生成；artifact 位于 ignored `artifacts/quality/continuity/`。
- Human blind-review sample count 与 inter-rater agreement threshold 仍是 decision-required；实现不自行发明通过阈值。
- 真实人工盲评与 #139 固定质量 registry 消费不在本票伪造完成。
