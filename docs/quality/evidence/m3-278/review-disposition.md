# M3-278 外部审查处置记录

> 来源：`review-findings.source.json`，其中固定用户提供的
> `approval-request.review-notes.md` SHA-256。
>
> 性质：审查发现处置，不是审批 payload。

## 已修复的 6 项硬问题

| Sample | 处置 |
| --- | --- |
| Q034 | 把“茶棚人物提前知道密信”补为必需节拍。 |
| Q055 | 补充沈砚从未打开旧匣、也无人告知，证明无权知情。 |
| Q067 | 删除断腕/空袖升级，改回左臂骨折夹板未拆。 |
| Q081 | 改回照骨镜与冬至祭真名预言，移除无关旧信。 |
| Q084 | 对齐“北境关比旧城晚三十日”既定事实，移除船夫矛盾。 |
| Q123 | 移除墨迹新旧暗示，改为同源抄本在共同祖先页直接分歧。 |

## 仍需负责人裁决的 11 项

Q026、Q075、Q088、Q093、Q096、Q130、Q149、Q160、Q182、Q186、Q189。

逐项问题已写入 `approval-request.md` 的“待负责人裁决”章节，并在 approval template
中增加 `reviewDecision` 与 `reviewDecisionRationale`。模型没有填写
`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、
`attestationId`、`decidedAt`、`reviewDecision` 或 `reviewDecisionRationale`。

## Owner 可见性

每项现在包含 `establishedFact`，并绑定到 `replacement-manifest.json` 与
`approvals.template.json`。该字段只进入 owner 材料，不进入 reviewer packet。

当前仍为 `0/24` 人工批准、`freezeAllowed=false`，没有冻结 packet，也没有发布 attestation。
