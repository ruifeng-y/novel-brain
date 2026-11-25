# M3-07d-03 质量包隐藏真值与待裁决样本

> Issue: #273
> Capabilities: CONT-001 supporting evidence
> Status: implementation prepared; **blocked-awaiting-human-adjudication**

## 结论

#273 需要真实产品/质量负责人对 24 个 long-horizon 样本、整包处置、旧评分影响和
`hook_prose_score` 失败作出决定。当前没有可用的真人裁决输入，因此本票不关闭，
CONT-001 继续为 `implemented`，V1 release gate 继续 blocked。

本轮没有修改冻结 rubric、冻结 dataset、#239 原始问卷、816 条人工原始评分或旧 packet。
模型没有补写裁决人、身份声明、时间、理由或影响。

## 已实现

- 新增 `scripts/m3-273-adjudication.mjs`，从已冻结的 #239 证据确定 24 个污染样本。
- 生成 204 个样本的无显式 oracle 注释候选包
  `docs/quality/evidence/m3-273/reviewer-packet-v2.proposal.json`：
  - 样本数仍为 204，删除样本数为 0。
  - 只对 24 个样本应用 `strip-explicit-oracle-annotation-v1`。
  - 候选包状态固定为 `proposed-not-approved`。
  - reviewer-facing sample schema 仍仅为 `blindSampleId`、`genre`、`text`、
    `requiredBeats`。
- 生成 24 项空白裁决模板和 owner-only 决策请求；所有真人字段保持 `null`。
- 生成机器状态 `docs/quality/evidence/m3-273/status.json`，当前结果为：
  - `completedAdjudicationCount: 0`
  - `pendingAdjudicationCount: 24`
  - no approved clean packet
  - `hook-prose-disposition-pending`
  - inter-rater variance threshold 仍独立归属 #240。
- `buildContinuityBlindReviewPacket` 现在会移除显式事实对照注释，并在报告中拒绝仍含
  oracle 注释的 re-hashed packet：`blind-review-oracle-content-leak`。
- V1 release gate 读取 #273 机器账本；若账本仍 blocked 但 `human-blind-review` gate
  声称 pass，或 #240 threshold 仍 pending，发布检查会失败。

## 证据

- 候选包 SHA-256：
  `385876e432fe4056c460708b6ddcb814db9625a4255f7643fbf1ad2f1320c02d`
- 污染样本身份：
  `docs/quality/evidence/m3-273/oracle-cleanup-evidence.json`
- 真人待填模板：
  `docs/quality/evidence/m3-273/adjudication.template.json`
- 决策请求：
  `docs/quality/evidence/m3-273/decision-request.md`
- 机器状态：
  `docs/quality/evidence/m3-273/status.json`
- 原始人工评分：
  `docs/quality/evidence/m3-239/human-scores.json`

## 仍需真人完成

- 24/24 样本的真实裁决、理由、影响、裁决人、attestation 和时间。
- 明确候选包重冻、样本替换或经产品负责人批准保留，以及旧评分是否失效。
- `hook_prose_score = 1.882353 < 4` 的修复重跑或完整 waiver。
- #240 单独审批 inter-rater variance threshold；#273 无权代批。

## 验证

```powershell
node scripts/m3-273-adjudication.mjs --check
pnpm exec vitest run packages/continuity-benchmark/test/blind-review.test.ts packages/continuity-benchmark/test/report.test.ts scripts/test/m3-273-hidden-truth-adjudication.test.mjs scripts/test/v1-release-gate.test.mjs
pnpm test:guardrails
pnpm release:check
```

`pnpm release:check` 仍应失败。当前预期真缺口包括 #273、#240、#271 和最终 #242
Production CI，不得把机器准备的候选包解释为质量通过。
