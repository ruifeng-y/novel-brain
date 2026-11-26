# M3-07d-01 冻结质量包人工盲评

> Issue: #239
> Capabilities: CONT-001, EVAL-002 supporting evidence
> Status: complete-with-warnings; 816 raw human scores are recorded, while V1 quality remains blocked

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
  样本文本本身包含“与已确认事实冲突”等缺陷元信息，因此 clean blind review 仍为 false。
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
- `technicalStatus: passed`；派生证据可由原始问卷、CSV、notes 和 packet 确定性重算，
  `--check-files` / `--check` 均无 stale file。原始输入本身不由脚本重建。
- 观察到的 max inter-rater variance：`0`。
- Reviewed samples requiring follow-up adjudication: 24 long-horizon cases; reviewers
  recorded that these samples contain defect metadata rather than narrative prose.
- Packet oracle-content check: 24 long-horizon texts expose defect metadata;
  `cleanBlindReview: false`.
- 两名评审人的 completion timestamp 相同，保留为 warning；冻结 rubric 没有禁止该情况。

## 判定依据

Issue #239 的验收范围是“由真实评审人完成评分并记录原始分数”，不是批准文本质量或阈值。
两名评审人的签名问卷、816 条原始分数、reviewer/time/confidence/evidence/concerns 和冻结
packet hash 均已归档，因此本票可关闭为 `complete-with-warnings`。

相同完成秒不是无风险证据：两名 reviewer 的时间完全一致，可能表示批量提交或模板化填表。
当前判定依据是用户明确确认两份评分由真实评审人完成，并且两份问卷分别签署、attestation id
不同、816 条记录可逐项复算；该风险保留为 warning，不升级为“质量已通过”。

以下项目继续阻断 V1 quality claim：

- `hook_prose_score = 1.882353 < 4`。
- 24/24 替换裁决已完成；#278 已生成 24 个候选和 204 样本 candidate packet，但 `0/24` 人工批准、尚未冻结；#279 的全量重评仍待完成。
- 旧 24 个 long-horizon 样本文本仍暴露缺陷元信息，旧 packet 的 `cleanBlindReview` 为 `false`，因此不得复用。
- reviewer identity 目前是自述化名，外部实名核验未提供。

## #273 后续准备

#273 已在 `docs/quality/evidence/m3-273/adjudication.json` 记录 24/24 产品负责人
`replace_sample` 决定，并将旧评分对 clean review 的影响记为
`invalidated_for_clean_review`。`hook_prose_score` 选择 `remediate_and_rerun`。
#278 已生成 24 个替代文本、可复现 manifest 与 candidate packet；当前等待 owner 逐项批准后冻结。 #279 负责完整 204 样本重评。外部 GitHub
attestation 已由 `ruifeng-y` 本人发布并记录。

旧 #239 文件保持原样；其结果段中的 0/24 和 `threshold: null` 是当时的历史快照。

#240 已独立批准 `interRaterVarianceThreshold = 0.1`；该历史快照中的 `null` 不改变，
下游必须消费 `docs/quality/evidence/m3-240/review-policy.json`。

#239 关闭不改变 #104 的 blocked 状态，也不授权任何质量、阈值或容量声明。
