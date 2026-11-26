# M3-07d-03 质量包隐藏真值与待裁决样本

> Issue: #273
> Capabilities: CONT-001 supporting evidence
> Status: decision and external attestation complete; **release blocked by #278/#279**

## 结论

产品/质量负责人已完成 24/24 真人裁决：替换污染样本、旧评分对 clean review 失效、
`hook_prose_score` 修复后重跑。外部 GitHub attestation 已发布并由发布门禁验证通过；
本票的裁决职责已完成。CONT-001 继续为 `implemented`，V1 release gate 由 #278/#279
继续 blocked。

本轮没有修改冻结 rubric、冻结 dataset、#239 原始问卷、816 条人工原始评分或旧 packet。
模型没有补写裁决人、身份声明、时间、理由或影响。

## 已实现

- 新增 `scripts/m3-273-adjudication.mjs`，从已冻结的 #239 证据确定 24 个污染样本。
- 生成 204 个样本的无显式 oracle 注释候选包
  `docs/quality/evidence/m3-273/reviewer-packet-v2.proposal.json`：
  - 样本数仍为 204，删除样本数为 0。
  - 只对 24 个样本应用 `strip-explicit-oracle-annotation-v1`。
  - 候选包状态固定为 `proposed-not-approved`。
  - `reviewerReadiness.status` 固定为 `not-ready`；移除显式注释不等于通过语义盲评。
  - reviewer-facing sample schema 仍仅为 `blindSampleId`、`genre`、`text`、
    `requiredBeats`。
- 记录 `adjudication.json`：24/24 `replace_sample`、旧评分
  `invalidated_for_clean_review`、hook/prose `remediate_and_rerun`。
- #278 已生成 24 个替代文本和 clean packet candidate；等待 24/24 人工批准后冻结。#279 负责 benchmark 文风修复及完整
  204 样本双人重评；两者均阻塞 #242。
- 生成机器状态 `docs/quality/evidence/m3-273/status.json`，当前结果为：
  - `completedAdjudicationCount: 24`
  - `pendingAdjudicationCount: 0`
  - no approved clean packet
  - `clean-blind-review-required`
  - `hook-prose-remeasurement-pending`
  - inter-rater variance threshold 已由 #240 独立批准为 `0.1`。
- `buildContinuityBlindReviewPacket` 现在会移除显式事实对照注释，并在报告中拒绝仍含
  oracle 注释的 re-hashed packet：`blind-review-oracle-content-leak`。
- V1 release gate 读取并重算 #273 机器账本；若账本仍 blocked 但
  `human-blind-review` gate 声称 pass，或机器状态未绑定 #240 的正式 `0.1` review policy，
  发布检查会失败。
- `pnpm release:check` 会从 proposal、cleanup audit、空白模板或真人 `adjudication.json`
  重新计算状态，并拒绝与 `status.json` 不一致的手改账本。
- 真人证据必须绑定 #273 上由 owner/member/collaborator 发布的 GitHub comment；发布检查会
  通过 API 核对评论作者关联、时间、正文 marker、proposal hash 和最终 decision payload
  hash，不信任本地自报的 `adjudicatorKind`；裁决内容变化会使旧 comment 失效。
- 外部 attestation：
  [#issuecomment-7183183858](https://github.com/ruifeng-y/novel-brain/issues/273#issuecomment-7183183858)。
- 选择 `refreeze_clean_packet` 或 `replace_affected_samples` 后仍需新的 clean human
  blind review；本票不会用算法删除注释代替重新盲评。

## 证据

- 候选包 SHA-256：
  `602bf4a2f11181d0d92b05ea7a908863f7181f14d37fe6fe525faafa752b7db3`
- Decision payload SHA-256：
  `70856c509b9b77fe1312e80a15c60e40e4b83f861d70618740d6a12602447d4d`
- 污染样本身份：
  `docs/quality/evidence/m3-273/oracle-cleanup-evidence.json`
- 真人待填模板：
  `docs/quality/evidence/m3-273/adjudication.template.json`
- 已记录真人决定：
  `docs/quality/evidence/m3-273/adjudication.json`
- 已由本人发布的 attestation 正文：
  `docs/quality/evidence/m3-273/attestation-comment.md`
- 决策请求：
  `docs/quality/evidence/m3-273/decision-request.md`
- 机器状态：
  `docs/quality/evidence/m3-273/status.json`
- 原始人工评分：
  `docs/quality/evidence/m3-239/human-scores.json`

## 仍需完成

- #278 完成 24/24 替代样本逐项人工批准并重建 clean packet。
- #279 完成 benchmark corpus 修复和完整 204 样本双人重评。
- #240 已单独批准 inter-rater variance threshold `0.1`；#273 无权修改或替代该决定。

## 验证

```powershell
node scripts/m3-273-adjudication.mjs --check
pnpm exec vitest run packages/continuity-benchmark/test/blind-review.test.ts packages/continuity-benchmark/test/report.test.ts scripts/test/m3-273-hidden-truth-adjudication.test.mjs scripts/test/v1-release-gate.test.mjs
pnpm test:guardrails
pnpm release:check
```

`pnpm release:check` 仍应失败。当前预期真缺口包括 #278、#279 和最终 #242 Production CI，
不得把机器准备的候选包解释为质量通过。
