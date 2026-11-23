# M3-07 V1 UI Parity 与发布收口

> Issue: #104
> Capabilities: UI-001, UI-002, UI-003, UI-004, UI-005, UI-006, UI-007, UI-008, UI-009
> Status: integration implementation in progress; release sign-off is blocked by remaining UI, capability, action-persistence, human-quality, provider-smoke and final-CI evidence.

## 实现结果

- 17 个生产页面均有唯一 owner、production Playwright spec 和四档生产 Golden；`auth.spec.ts` 新增直接 `toHaveScreenshot` 与 `prototype_only` 扫描。
- 当前 `auth`、`help`、`legal`、dashboard、new-project、work-overview、bible、settings、outline、foreshadows、writing、batch、changes、export-publish 与 work-settings 为 `parity-verified`；其余 2 个非静态页面在逐动作 API/持久化审计和最终 Linux/Chromium PR CI 通过前保持 `production-built`。dashboard 已补齐完整列表筛选、主线持久化指标、四档 Golden、作者视觉签收和最终正常 PR CI；new-project 已补齐七个入口动作的真实 API、持久化断言和最终正常 PR CI；work-overview 已补齐七个总览动作、卷末审计/签收回读和最终正常 PR CI；bible 已补齐九卡生成、编辑、准备度、补全、世界铁律、锁定、版本、修改请求和解锁的持久化证据与最终正常 PR CI；settings 已补齐十个设定动作、人物关系和题材包切换的持久化证据与最终正常 PR CI；outline 已补齐 11 个大纲动作、黄金三章选择与视图持久化回读证据和最终正常 PR CI；foreshadows 已补齐九个账本动作、检查结果与持久化风险记录绑定证据和最终正常 PR CI；writing 已补齐 18 个写作动作、新章节、append-only 旧版恢复和最终正常 PR CI；batch 已补齐 7 个任务控制动作、失败步骤重试、按需成本报告、审核决策与最终正常 PR CI；changes 已补齐 7 个修改与版本动作、append-only 回滚、平行版本与逐对象摘取和最终正常 PR CI；export-publish 已补齐 7 个导出发布动作、下载响应头与内容哈希、固定预览、过期清理、申诉和重新导出证据及最终正常 PR CI；work-settings 已补齐 9 个作品设置动作、保守复制、归档恢复、回收站、导出后永久删除和关联数据清理证据及最终正常 PR CI。
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

- Non-UI capability 审计已完成：107 项中 97 项 `verified`，WORK-002、IO-001、IO-003、CHANGE-004、CHANGE-005、CHANGE-006、EVAL-002、EVAL-003、EVAL-004、CONT-001 仍有有界缺口；机器账本见 `docs/implementation/m3-236-non-ui-capability-evidence.json`；
- UI-001..UI-009 的总 traceability 收口仍由 #238 负责；
- 真实 human blind review 记录；
- 已批准的 inter-rater variance threshold；
- `provider-smoke` environment 的手动真实 Provider smoke 结果；
- 最终 #104 Production CI 的绿色运行链接。

在补齐以上证据并更新 traceability 之前，`#104` 保持 `OPEN`，不得宣称 V1 发布完成。
