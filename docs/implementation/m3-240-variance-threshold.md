# M3-07d-02 Inter-rater Variance Threshold 批准与登记

> Issue: #240
> Capabilities: EVAL-002
> Status: decision complete; V1 release remains blocked by #242, #278, #279 and `hook_prose_score`

## 决定

- `interRaterVarianceThreshold = 0.1`
- Owner: `product-owner`
- 批准日期：`2026-11-26`
- 策略证据：`docs/quality/evidence/m3-240/review-policy.json`

选择 `0.1` 的依据是 `hook_prose_score` 允许 1–5 的整数或半档分。两名评审人相差 1 分时总体方差为
`0.25`，高于 `0.1`，因此任何整档分差都会阻断发布；相差 0.5 分时方差为 `0.0625`，仍可通过。
冻结的 816 条人工评分中，408 个样本-维度配对全部同分，`maxVariance = 0`，所以当前结果
通过该策略。

## 发布判定与超阈值处理

Release gate 仅在 `maxVariance > 0.1` 时记录
`inter-rater-variance-above-threshold` 并保持 blocked。超阈值处理固定为：

1. 列出超阈值的 sample 和 dimension。
2. 保留原始评分，不覆盖、不删除。
3. 转交 #273 的裁决流程或新增独立评审人。
4. 处置后重跑完整质量与发布门禁。
5. V1 quality claim 不接受 waiver，也不允许通过调整阈值解除阻断。

批准阈值只解除 `decision-required:interRaterVarianceThreshold`。当前 release 仍因
`hook_prose_score = 1.882353 < 4`、#278 的 24/24 人工批准与 packet 冻结、#279 的完整 204 样本
重评和 #242 release-head CI 保持 blocked。

## Completion Time Warning

两名评审人的 `reviewedAt` 与 `submittedAt` 均为
`2026-11-25T15:51:16+08:00`。产品负责人接受该 warning，并记录为：该时间表示同批次提交时间，
不是实际评审耗时；独立评分声明、64/204 个 hook confidence 差异和不同 retained concerns
提供辅助证据。408/408 配对同分不作为独立性证明，`cleanBlindReview` 继续为 `false`，
warning 继续保留在质量证据中。

## 冻结边界

- 未修改 `docs/quality/quality-benchmark-v1.rubric.json`，其 `reviewPolicy` 仍为 `null`。
- 未修改 dataset、manifest、原始评分或 #239 的生成证据。
- `0.1` 只通过独立 trusted review-policy artifact 传入 evaluator。
- 若以后调整阈值，必须重新记录 owner、日期、rationale 和 release-gate 影响。

## 验证

```powershell
pnpm exec vitest run scripts/test/m3-240-variance-threshold.test.mjs --testTimeout 15000
pnpm test:guardrails
pnpm check:pr
pnpm check:migrations
```
