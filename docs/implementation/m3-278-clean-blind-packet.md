# M3-07d-04 替换长线污染样本并重建 clean 盲评包

> Issue: #278
> Capabilities: CONT-001 supporting evidence
> Status: **candidate prepared; awaiting 24/24 human approval; packet not frozen**

## 结论

#278 的候选准备阶段已完成：24 个 flagged sample 均有唯一、无显式 oracle 元信息的替代叙事，
候选 dataset 与 reviewer packet 都保留 204 个样本身份。候选文本保留结构化 ground truth 中的
scenario family 与 severity，但 reviewer-facing sample 只暴露 `blindSampleId`、`genre`、
`text`、`requiredBeats`。

当前只有 `0/24` 个候选获得人工批准，`freezeAllowed=false`。因此没有生成冻结版 v2 dataset
或最终 reviewer packet，`#278` 保持 OPEN，`CONT-001` 保持 `implemented`，#242 继续被
#278/#279 阻塞。

## 实现

- 新增 `scripts/m3-278-clean-packet.mjs`，从 #273 的 24/24 `replace_sample` 裁决、冻结 v1
  dataset、#239 packet/key 和 #240 review policy 生成候选。
- 24 个替代叙事位于
  `docs/quality/evidence/m3-278/replacement-candidates.source.json`。
- `replacement-manifest.json` 对每个样本绑定：
  - `blindSampleId` 与 `datasetSampleId`
  - original / replacement / original required beats / replacement required beats hash
  - #273 adjudication entry、source dataset sample 与 candidate source evidence hash
  - candidate dataset/packet hash
- 候选 v2 dataset 包含 180 个 chapter sample 与 24 个 long-horizon sample，共 204 个唯一 ID，
  没有删除样本。
- 候选 reviewer packet 对全部 204 个样本执行泄漏扫描：oracle marker、内部证据字段、
  defect family、severity label、模型身份与生成状态均不得进入样本文本或字段。
- `approvals.template.json` 固定 24 个逐项审批位置，并绑定 candidate dataset、packet、
  replacement manifest 与每个 manifest entry 的 hash。模型批准、重复、未知、证据漂移、
  缺字段、非 human 或缺少外部 GitHub attestation 均不能解锁冻结。
- Owner 材料新增 `establishedFact`，从 #239 原样本的既定事实提取并绑定到 manifest 与
  approval payload；reviewer packet 仍只包含四个盲评字段。
- 外部审查指出的 6 项硬问题已修正：Q034 节拍补入违规句，Q055 补齐无权知情，Q067 改回
  左臂骨折，Q081 改回照骨镜伏笔，Q084 对齐北境关时间事实，Q123 移除墨迹伪造机制。
- 11 项需要产品/语义取舍的问题作为“待负责人裁决”列表写入 approval request，并增加
  `reviewDecision` / `reviewDecisionRationale` 供负责人显式回答，不由模型代签。
- 外部 attestation 会通过 GitHub API 核对 comment 作者关联、Issue 278、创建时间、正文
  marker、candidate packet hash、replacement manifest hash 和 24 项审批 payload hash；
  comment 作者必须是产品/质量负责人 `ruifeng-y` 且关联为 `OWNER`。每个
  `adjudicatorId` 必须等于评论作者，`attestationId` 必须使用该样本的固定审批 token
  `M3-278-APPROVAL-<sampleId>`，只填写本地 `human` 字段无效。
- `branch_divergence` 候选使用同源年表或双册村志的叙事冲突表达分支隔离，不在 reviewer
  文本中直接写“分支”“未来真相”等 oracle 提示。
- `approval-request.md` 是 owner 审阅入口，列出 sample ID、场景 family、severity、候选叙事、
  必须保留的 beats 和逐项 approval 字段。
- `review-findings.source.json` 固定外部审查原文 SHA-256 与机器可读处置；
  `review-disposition.md` 记录 6 项硬问题已修，11 项语义取舍仍待 owner 裁决。

## 候选 Hash

- Candidate dataset:
  `c8079604dfc8774d1aa0fbfa67c816f145cd4ae3705d75da30b5a27634ead4bd`
- Candidate reviewer packet:
  `9569e6dd661ec2765b08fc3381f4b8406a37b0a4f66f4224c7cfa68b1aec8a6a`
- Replacement/change manifest:
  `f8a8f0315c32fa5e751faa70fc2723916730cde9193456b838401a7ccb29e5a3`
- Frozen rubric: `247a1fcc0c0ce58bca7faa8a93a8b0d0e39c4095fc2f1c5748767b53d6fc1b3b`
- #240 variance policy: `0.1`

旧 `quality-benchmark-v1` dataset、#239 packet、816 条 raw scores 和 rubric 均未改写。旧评分
保持 `invalidated_for_clean_review`，不进入 clean-review evidence。

## 人工门

owner 审阅入口：

`docs/quality/evidence/m3-278/approval-request.md`

机器模板：

`docs/quality/evidence/m3-278/approvals.template.json`

真实批准必须复制模板为 `approvals.json` 并逐项填写，不能由模型代填。24/24 完成后，还必须在
#278 发布包含 `M3-278-HUMAN-APPROVAL` 和候选 packet hash 的外部 GitHub comment。当前
`status.json` 的 pending sample IDs 为全部 24 个 flagged ID。

## 验证

```powershell
pnpm quality:clean-packet -- --check
pnpm exec vitest run scripts/test/m3-278-clean-blind-packet.test.mjs
```

测试覆盖：

- 24/24 replacement 覆盖且唯一；
- 204/204 dataset 与 packet identity 保留；
- reviewer packet 无 oracle、defect、severity、内部字段或模型身份泄漏；
- 未完成 24/24 human approval 与外部 attestation 时禁止冻结；
- dataset、packet 与 replacement manifest hash 可重复生成；
- approval Markdown 包含全部 24 个 sample 的候选文本、beats 和审批字段。

## 仍未完成

- 真实产品/质量负责人逐项批准 24/24 replacement。
- 批准完成后冻结 clean v2 dataset/packet，再交给 #279 做完整 204 样本双人盲评。
- #279 修复 benchmark prose 并重评；`hook_prose_score` 仍为 `1.882353 < 4`。
- #242 最终 Production CI 与 V1 release decision。
