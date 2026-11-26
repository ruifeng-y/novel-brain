# M3-07 V1 UI Parity 与发布收口

> Issue: #104
> Capabilities: UI-001, UI-002, UI-003, UI-004, UI-005, UI-006, UI-007, UI-008, UI-009
> Status: integration implementation complete; V1 release sign-off remains blocked by human
> quality, final CI and two bounded non-UI capability gaps.

## 实现结果

- 17 个生产页面均有唯一 owner、production Playwright spec、四档生产 Golden 和 `parity-verified` 状态。
- 15 个非静态页面均有完整 action contract 与 `verified` action evidence，不再存在 pending 页面；`auth.spec.ts` 包含直接 `toHaveScreenshot` 与 `prototype_only` 扫描。
- UI-001..UI-009 已由 #238 收口到 `docs/implementation/m3-238-ui-capability-evidence.json`；机器账本把每项 UI capability 绑定到可执行 guardrail、页面 Playwright 证据，并由 release gate 校验当前 HEAD 的绿色 Production CI。
- `scripts/validate-readiness.mjs` 校验页面、依赖和 Golden 结构；`pnpm release:check` 才负责要求所有生产页面为 `parity-verified` 或 `deviation-approved`。
- `docs/ui/prototype-contract.md` 与 `docs/ui/v1-ui-parity-matrix.md` 已对齐 M0–M3 当前生产状态。
- `#98/#99/#100/#101/#103` package parents 已用子项合并与 CI 证据关闭。
- `PERF-001/#137` 按 V1 范围决定延期，V1 不声明 10M 容量已认证；`#102/#137` 已关闭。
- V1 总发布清单见 `docs/implementation/v1-release-checklist.md`；机器可执行门禁读取 `docs/implementation/v1-release-evidence.json`、`docs/planning/v1-deferrals.json`、`docs/ui/v1-ui-deviations.json`、`docs/ui/v1-action-contract.json` 和 `docs/implementation/v1-action-evidence.json`，并校验 P0、waiver owner/rationale、required gates、页面 parity、授权延期、deviation 审批、逐动作 API/持久化证据和证据可复现性。
- #239 已归档 816 条人工原始评分并关闭为 `complete-with-warnings`；#273 已记录 24/24 替换裁决和 external attestation。#278 已生成 24 个候选、可复现 manifest 和 204 样本 candidate packet，但 `0/24` 人工批准、尚未冻结；#279 full rerun 仍是 V1 release 质量阻断项。
- 观察值为 `outline_adherence = 1.000000`、`hook_prose_score = 1.882353`，其中文风门禁失败。
- #240 已由 `product-owner` 批准 `interRaterVarianceThreshold = 0.1`；冻结评分观察到
  `maxVariance = 0`，阈值策略通过，不修改 rubric 或原始评分。

## 验证

本地已通过：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test:guardrails`、`pnpm exec vitest run --testTimeout 15000`、`pnpm check:migrations`、`node scripts/validate-readiness.mjs`。`pnpm release:check` 按设计返回 `BLOCKED`。

`pnpm check:pr`、Production CI 的 `check`、`playwright` 和 Deployment Smoke 的 `compose-smoke` 仍必须在最终 PR 上执行并通过。
本地 Windows 执行 `auth.spec.ts` 的 Golden 比较会出现平台字体/渲染差异；正式证据只接受 `docs/ui/production-visual-regression.md` 规定的 Linux/Chromium CI Golden。

## 发布边界

自动化完成不等于 V1 release approved。以下证据仍缺失：

- Non-UI capability 审计已完成：107 项中 105 项 `verified`，EVAL-002、CONT-001 仍有有界缺口；EVAL-002 的阈值决定已由 #240 完成，但最终 release-head CI 仍待 #242；CONT-001 的 #273 已记录 24/24 替换裁决，`hook_prose_score` 仍待 #279 全量重评；CHANGE-004 至 CHANGE-007 已由 #263 补齐证据并绑定 Production CI；EVAL-004 已由 #271 的模型身份 alias 规则与 Production CI 验证；机器账本见 `docs/implementation/m3-236-non-ui-capability-evidence.json`；
- UI-001..UI-009 与总 traceability 已由 #238 完成，17 页与 UI capability 不再是发布阻塞项；
- #273 已记录 24/24 替换裁决及 external attestation；#278 候选等待 24/24 人工批准并冻结，#279 尚未完成，
  `hook_prose_score = 1.882353 < 4` 的处置仍为 remediation/rerun；
- 最终 #104 Production CI 的绿色运行链接。

在补齐以上发布级证据之前，`#104` 保持 `OPEN`，不得宣称 V1 发布完成。
