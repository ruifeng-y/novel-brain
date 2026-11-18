# M3-07 V1 UI Parity 与发布收口

> Issue: #104
> Capabilities: UI-001, UI-002, UI-003, UI-004, UI-005, UI-006, UI-007, UI-008, UI-009
> Status: integration implementation in progress; release sign-off is blocked by remaining UI, capability, action-persistence, human-quality, provider-smoke and final-CI evidence.

## 实现结果

- 17 个生产页面均有唯一 owner、production Playwright spec 和四档生产 Golden；`auth.spec.ts` 新增直接 `toHaveScreenshot` 与 `prototype_only` 扫描。
- 当前仅 `legal` 为 `parity-verified`；15 个非静态页面在逐动作 API/持久化审计和最终 Linux/Chromium PR CI 通过前保持 `production-built`，`help` 还需真实生产路由错误边界与重试恢复证据。
- `scripts/validate-readiness.mjs` 校验页面、依赖和 Golden 结构；`pnpm release:check` 才负责要求所有生产页面为 `parity-verified` 或 `deviation-approved`。
- `docs/ui/prototype-contract.md` 与 `docs/ui/v1-ui-parity-matrix.md` 已对齐 M0–M3 当前生产状态。
- `#98/#99/#100/#101/#103` package parents 已用子项合并与 CI 证据关闭。
- `PERF-001/#137` 按 V1 范围决定延期，V1 不声明 10M 容量已认证；`#102/#137` 已关闭。
- V1 总发布清单见 `docs/implementation/v1-release-checklist.md`；机器可执行门禁读取 `docs/implementation/v1-release-evidence.json`、`docs/planning/v1-deferrals.json`、`docs/ui/v1-ui-deviations.json`、`docs/ui/v1-action-contract.json` 和 `docs/implementation/v1-action-evidence.json`，并校验 P0、waiver owner/rationale、required gates、页面 parity、授权延期、deviation 审批、逐动作 API/持久化证据和证据可复现性。

## 验证

本地已通过：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test:guardrails`、`pnpm exec vitest run --testTimeout 15000`、`pnpm check:migrations`、`node scripts/validate-readiness.mjs`。`pnpm release:check` 按设计返回 `BLOCKED`。

`pnpm check:pr`、Production CI 的 `check`、`playwright` 和 Deployment Smoke 的 `compose-smoke` 仍必须在最终 PR 上执行并通过。
本地 Windows 执行 `auth.spec.ts` 的 Golden 比较会出现平台字体/渲染差异；正式证据只接受 `docs/ui/production-visual-regression.md` 规定的 Linux/Chromium CI Golden。

## 发布边界

自动化完成不等于 V1 release approved。以下证据仍缺失：

- `help` 的真实生产路由错误边界触发与重试恢复 Playwright 证据；
- 116 个仍为 `mapped`/`implemented` 的 V1 capability 逐项证据审计；
- 15 个非静态生产页的逐动作 API 与持久化结果证据；
- 真实 human blind review 记录；
- 已批准的 inter-rater variance threshold；
- `provider-smoke` environment 的手动真实 Provider smoke 结果；
- 最终 #104 Production CI 的绿色运行链接。

在补齐以上证据并更新 traceability 之前，`#104` 保持 `OPEN`，不得宣称 V1 发布完成。
