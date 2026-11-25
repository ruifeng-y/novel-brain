# M3-07d-01 冻结质量包人工盲评

> Issue: #239
> Capabilities: CONT-001, EVAL-002 supporting evidence
> Status: human blind review complete and recorded; V1 quality release gate remains blocked

## 实施结果

- 使用冻结 dataset `quality-benchmark-v1`、rubric `adr-0022-v1` 和 blind-packet SHA-256
  `91b3c844070a69a4eea51d6583d816d5d732d9ccad95f972a2d6a77b0287c2fb`。
- 两名真实评审人分别完成 204 个样本的 `outline_adherence` 与 `hook_prose_score`，
  共 816 条 `human_blind` 原始分数。
- 所有评分记录包含 reviewer id、reviewer attestation id、review time、confidence、
  证据原文和保留意见；两名评审人的问卷均有签名和签署日期。
- reviewer-facing packet 只包含冻结合成样本、题材和必需节拍，不包含模型身份、
  生成状态、难度、known issue、分支、source fact id 或 oracle。
- 未修改冻结 dataset、manifest 或 rubric，未批准 inter-rater variance threshold。

## 证据

完整证据位于 `docs/quality/evidence/m3-239/`：

- `packet.json`、`key.json`
- `reviewer-01-questionnaire.md`、`reviewer-01-scores.csv`、`reviewer-01-notes.json`
- `reviewer-02-questionnaire.md`、`reviewer-02-scores.csv`、`reviewer-02-notes.json`
- `human-scores.json`、`validation.json`、`validation.md`
- `validate-review.mjs`

复现命令：

```powershell
node .\docs\quality\evidence\m3-239\validate-review.mjs
```

## 结果

| 人工维度 | 观察值 | 冻结门槛 | 结果 |
| --- | ---: | --- | --- |
| `outline_adherence` | 1.000000 | >= 0.9 | pass |
| `hook_prose_score` | 1.882353 | >= 4 | fail |

- 覆盖：2/2 reviewers、204/204 samples、816/816 human score rows。
- 结构证据：passed。
- 观察到的 max inter-rater variance：`0`。
- Reviewed samples requiring follow-up adjudication: 24 long-horizon cases; reviewers
  recorded that these samples contain defect metadata rather than narrative prose.
- 两名评审人的 completion timestamp 相同，保留为 warning；冻结 rubric 没有禁止该情况。

## 发布边界

Issue #239 的“完成盲评并记录原始分数”已满足，但 V1 quality gate 不能通过：

- `hook_prose_score = 1.882353 < 4`。
- `interRaterVarianceThreshold` 仍为 `null`，必须由 #240 单独决定。
- 24 个 long-horizon case 的叙事适用性保留意见仍需在产品/基准设计层面处理。

因此本票完成不改变 V1 release blocked 状态，也不授权任何质量或容量声明。
