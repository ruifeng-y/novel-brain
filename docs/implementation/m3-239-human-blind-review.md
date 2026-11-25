# M3-07d-01 冻结质量包人工盲评

> Issue: #239
> Capabilities: CONT-001, EVAL-002 supporting evidence
> Status: human score records captured; review remains incomplete until 24 flagged samples are adjudicated; V1 quality release gate is blocked

## 实施结果

- 使用冻结 dataset `quality-benchmark-v1`、rubric `adr-0022-v1` 和 evaluator gate hash
  `91b3c844070a69a4eea51d6583d816d5d732d9ccad95f972a2d6a77b0287c2fb`。
- 实际 reviewer packet 另以文件 SHA-256 和 canonical JSON SHA-256 固定，避免把
  evaluator 的 dataset/rubric gate hash 误当成展示包内容哈希。
- 用户提供的两名评审人分别填写 204 个样本的 `outline_adherence` 与 `hook_prose_score`，
  共 816 条 `human_blind` 原始分数。
- 所有评分记录包含 reviewer id、reviewer attestation id、review time、confidence、
  证据原文和保留意见；两名评审人的问卷均有签名和签署日期。
- reviewer 身份以可审计化名和自述声明记录；仓库证据本身不提供外部实名核验。
- reviewer-facing packet 的 schema 只包含冻结合成样本、题材和必需节拍，不包含模型身份、
  生成状态、难度、known issue 字段、分支或 source fact id。但 24 个 long-horizon
  样本文本本身包含“与已确认事实冲突”等缺陷元信息，因此 oracle content 仍是阻断项。
- 未修改冻结 dataset、manifest 或 rubric，未批准 inter-rater variance threshold。

## 证据

完整证据位于 `docs/quality/evidence/m3-239/`：

- `packet.json`、`key.json`
- `reviewer-01-questionnaire.md`、`reviewer-01-scores.csv`、`reviewer-01-notes.json`
- `reviewer-02-questionnaire.md`、`reviewer-02-scores.csv`、`reviewer-02-notes.json`
- `human-scores.json`、`validation.json`、`validation.md`
- `adjudication.template.json`
- `validate-review.mjs`

复现命令：

```powershell
node .\docs\quality\evidence\m3-239\validate-review.mjs
node .\docs\quality\evidence\m3-239\validate-review.mjs --check
```

## 结果

| 人工维度 | 观察值 | 冻结门槛 | 结果 |
| --- | ---: | --- | --- |
| `outline_adherence` | 1.000000 | >= 0.9 | pass |
| `hook_prose_score` | 1.882353 | >= 4 | fail |

- 覆盖：2/2 reviewers、204/204 samples、816/816 human score rows。
- 技术校验：passed；原始 CSV、notes 和 packet 可由 `--check` 重建为已提交证据。
- 观察到的 max inter-rater variance：`0`。
- Reviewed samples requiring follow-up adjudication: 24 long-horizon cases; reviewers
  recorded that these samples contain defect metadata rather than narrative prose.
- Packet oracle-content check: 24 long-horizon texts expose defect metadata; this must be
  corrected or explicitly resolved before a future blind review can be considered clean.
- 两名评审人的 completion timestamp 相同，保留为 warning；冻结 rubric 没有禁止该情况。

## 发布边界

Issue #239 尚未完成。原始分数已记录，但 24 个样本由两名评审人共同标记为待裁决，
尚无真实 adjudication 结果，因此不能把盲评声明为 complete。V1 quality gate 也不能通过：

- `hook_prose_score = 1.882353 < 4`。
- `interRaterVarianceThreshold` 仍为 `null`，必须由 #240 单独决定。
- 24 个 long-horizon case 的叙事适用性保留意见仍需在产品/基准设计层面处理。
- 24 个 long-horizon 样本文本仍暴露缺陷元信息，不满足 clean blind-packet 条件。

因此 #239 保持 `OPEN`，并继续阻塞 #104；不得授权任何质量或容量声明。
