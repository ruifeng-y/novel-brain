# V1 UI Parity Matrix

> Status: pre-production implementation contract, updated 2026-11-10.
> Authority: docs/ui/prototype-contract.md and docs/ui/v1-prototype-signoff.md.
> The signed-off prototype baseline comprises **18 prototype pages**: 17 production page contracts + one prototype-only state gallery. The nine M0 production pages have committed golden screenshots and author sign-off. The eight M1 acceptance pages also have author visual sign-off; all eight remain `production-built` until #174 completes their formal Golden, required-state and leakage-scan evidence.

## 1. Status and evidence semantics

| State | Meaning |
| --- | --- |
| prototype-signed | The prototype page/action/state contract has been signed off and has source screenshots. |
| production-pending | The production route/page is not implemented or its required evidence is not complete. |
| production-built | Production route and real actions exist; full parity evidence is still pending. |
| parity-verified | Route, actions, API behavior, required states, four viewports, visual comparison and author language all pass. |
| deviation-approved | A specific deviation was accepted by the product owner and recorded with reason/scope/replacement baseline. |
| prototype-only | Demonstration-only surface; forbidden in production. |

Only parity-verified or deviation-approved production pages can pass the V1 UI release gate. A prototype test or prototype screenshot is not production evidence.

## 2. Global contract

1. Prototype anchor, page actions, information hierarchy and required states are sourced from docs/ui/prototype-contract.md. Production API contracts are sourced from docs/technical/nestjs-backend-design.md and docs/technical/m0-protocol-freeze.md where the page is part of M0.
2. Every production page has exactly one primary page issue. Supporting issues own additional features/actions that appear on the same page; they do not replace the page's primary issue.
3. The primary feature ticket owns creation of its production parity spec at apps/web/e2e/parity/<page>.spec.ts. Supporting feature tickets add assertions to that same spec or linked feature specs. No page can be left without a named owner.
4. Prototype screenshot files are reference inputs only: prototype/screens/v1-baseline/<page>-<viewport>.png. The 1440 viewport is included alongside 1180/900/390.
5. Production golden output is expected at artifacts/ui/golden/<page>/<page>-<viewport>.png. The eight M1 acceptance pages have author visual sign-off. #172 generated eight formal baselines for entity-detail/foreshadows, and #176 generated eight formal normal/long baselines for work-overview. The remaining 20 M1 page files are historical and not current formal evidence; #174 regenerates them and completes the page checklist.
6. Fixed fixture, Chromium version and font environment must be pinned. Each page must cover primary actions, actual API/Worker effects, failure/empty/loading/disabled/permission/partial/conflict/long states as applicable.
7. Every visible interactive control must cause a real state change or be explicitly listed in prototype_only inventory. Toast-only actions, fake API responses and static data do not pass.
8. 1440 / 1180 / 900 / 390 viewport coverage is required. No horizontal overflow; page shell, content order, primary action placement and responsive breakpoints must match the signed-off baseline.
9. Author-facing language must not expose Agent, Canon, Context Pack, P0–P4, 正史 or other internal implementation terms.
10. UI-001–UI-009 are global cross-cutting requirements. #104 owns the final V1-wide audit; #79 owns the M0 UI closeout; feature issues listed below own each page's production implementation and evidence.
11. Production visual comparison follows `docs/ui/production-visual-regression.md`: pinned Chromium/font environment, four viewport baselines, deterministic fixtures, bounded pixel-diff tolerance, CI artifacts and explicit author approval for baseline changes.

## 3. Page-level ownership and evidence ledger

In the columns below, the prototype screenshot path and production test/golden path are **required artifact locations**. The status column records which production artifacts and approvals currently exist.

| Page ID | Prototype anchor | Production route | Milestone | Primary page issue | Supporting feature issues | Action / API contract source | Required page states | Prototype reference screenshots | Production Playwright parity spec | Production golden artifacts | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auth | #auth | /login · /register · /forgot-password · /reset-password | M0→M1 | #68 | 141, 69 | auth/password/session; M0 Protocol Freeze §5.1 | loading / error / disabled / permission / rate-limit / session-expired | `prototype/screens/v1-baseline/auth-{390,900,1180,1440}.png` | `apps/web/e2e/parity/auth.spec.ts` | `artifacts/ui/golden/auth/auth-{390,900,1180,1440}.png` (after author sign-off) | production-built |
| dashboard | #dashboard | /workspace | M0 | #70 | 97, 142 | works list/search/archive/restore; WorksModule API | loading / empty / error / disabled / long | `prototype/screens/v1-baseline/dashboard-{390,900,1180,1440}.png` | `apps/web/e2e/parity/dashboard.spec.ts` | `artifacts/ui/golden/dashboard/dashboard-{390,900,1180,1440}.png` | parity-verified |
| new-project | #new-project | /workspace/new-project | M0→M1/M2 | #70 | 71, 72, 84, 92, 126, 127 | five creation entries + import workflows; Works/Import APIs | loading / error / partial / disabled / long / conflict | `prototype/screens/v1-baseline/new-project-{390,900,1180,1440}.png` | `apps/web/e2e/parity/new-project.spec.ts` | `artifacts/ui/golden/new-project/new-project-{390,900,1180,1440}.png` | parity-verified |
| work-overview | #work-overview | /workspace/[workId]/overview | M0→M1 | #70 | 90, 97, 119, 148, 176 | work overview/readiness/progress/style baselines, cross-volume drift and volume audit; Works/Jobs/Style/VolumeAudit APIs | loading / empty / error / partial / readonly / archived / long | `prototype/screens/v1-baseline/work-overview-{390,900,1180,1440}.png` | `apps/web/e2e/parity/work-overview.spec.ts`, `apps/web/e2e/parity/readiness.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/work-overview/work-overview-{390,900,1180,1440}.png`; `artifacts/ui/golden/work-overview/work-overview-long-{390,900,1180,1440}.png` | production-built |
| bible | #bible | /workspace/[workId]/bible | M0→M1 | #143 | 73, 84, 87, 90 | nine-card generation/edit/lock/readiness/world-rules/versions/change-requests/unlock; StoryBible API | loading / empty / error / locked / proposal / partial / conflict / long | `prototype/screens/v1-baseline/bible-{390,900,1180,1440}.png` | `apps/web/e2e/parity/bible.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/bible/bible-{390,900,1180,1440}.png` | production-built |
| settings | #settings | /workspace/[workId]/settings | M0→M1/M2 | #144 | 74, 84, 92, 106–108, 90 | seven setting domains and typed CRUD; Canon/domain APIs | loading / empty / error / disabled / locked / proposal / long | `prototype/screens/v1-baseline/settings-{390,900,1180,1440}.png` | `apps/web/e2e/parity/settings.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/settings/settings-{390,900,1180,1440}.png` | production-built |
| outline | #outline | /workspace/[workId]/outline | M0→M1 | #145 | 75, 146–148, 90 | chapter brief/readiness, five-level outline, volume contracts, scene cards and golden-three; Planning/Chapters APIs | loading / empty / error / locked / partial / long | `prototype/screens/v1-baseline/outline-{390,900,1180,1440}.png` | `apps/web/e2e/parity/outline.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/outline/outline-{390,900,1180,1440}.png` | production-built |
| foreshadows | #foreshadows | /workspace/[workId]/foreshadows | M1 | #146 | 145, 117, 121, 90 | plot/foreshadow/character-arc ledger; Planning APIs | loading / empty / error / disabled / long | `prototype/screens/v1-baseline/foreshadows-{390,900,1180,1440}.png` | `apps/web/e2e/parity/foreshadows.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/foreshadows/foreshadows-{390,900,1180,1440}.png` | production-built |
| writing | #writing | /workspace/[workId]/write | M0→M1 | #76 | 75, 77, 78, 109–119, 148, 90 | chapter editor/version baseline, generation/context/facts/review/submit, nine writing actions and selection-scoped rewrite, critic findings, targeted revision rounds/diffs and author feedback; Chapters/Generation/Review/Quality/Revision/WritingAction APIs | loading / empty / error / disabled / partial / conflict / long | `prototype/screens/v1-baseline/writing-{390,900,1180,1440}.png` | `apps/web/e2e/parity/writing.spec.ts`, `apps/web/e2e/parity/readiness.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/writing/writing-{390,900,1180,1440}.png` | production-built |
| batch | #batch | /workspace/[workId]/batch | M2 | #152 | 91 (package), 151, 93, 97, 109–115, 149, 150 | parent/volume/chapter jobs, costs, review queue; Jobs APIs | loading / empty / error / partial / disabled / long / paused / failed | `prototype/screens/v1-baseline/batch-{390,900,1180,1440}.png` | `apps/web/e2e/parity/batch.spec.ts` | `artifacts/ui/golden/batch/batch-{390,900,1180,1440}.png` (after author sign-off) | production-pending |
| changes | #changes | /workspace/[workId]/changes | M2 | #120 | 121–125, 97 | change request/impact/version/branch/merge; Changes/Version APIs | loading / error / conflict / partial / disabled / stale-version | `prototype/screens/v1-baseline/changes-{390,900,1180,1440}.png` | `apps/web/e2e/parity/changes.spec.ts` | `artifacts/ui/golden/changes/changes-{390,900,1180,1440}.png` (after author sign-off) | production-pending |
| export-publish | #export-publish | /workspace/[workId]/export | M3 | #129 | 130, 131 | export receipt/manifest, publish checks and reader preview; Export APIs | loading / empty / error / partial / expired / long | `prototype/screens/v1-baseline/export-publish-{390,900,1180,1440}.png` | `apps/web/e2e/parity/export-publish.spec.ts` | `artifacts/ui/golden/export-publish/export-publish-{390,900,1180,1440}.png` (after author sign-off) | production-pending |
| work-settings | #work-settings | /workspace/[workId]/work-settings | M1 | #142 | 134 | cover/tags/status/copy/archive/trash; Works APIs | loading / error / disabled / permission / readonly / confirmation | `prototype/screens/v1-baseline/work-settings-{390,900,1180,1440}.png` | `apps/web/e2e/parity/work-settings.spec.ts` | `artifacts/ui/golden/work-settings/work-settings-{390,900,1180,1440}.png` (after author sign-off) | production-pending |
| entity-detail | #entity-detail | /workspace/[workId]/settings?column=<column>&entityId=<entityId> | M1 | #106 | 74, 107, 108, 144, 90 | entity/relationship/knowledge/resource state; domain APIs | loading / empty / error / disabled / locked / proposal / long | `prototype/screens/v1-baseline/entity-detail-{390,900,1180,1440}.png` | `apps/web/e2e/parity/entity-detail.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/entity-detail/entity-detail-{390,900,1180,1440}.png` | production-built |
| account-settings | #account-settings | /workspace/settings · /workspace/settings/account | M0→M1/M3 | #69 | 141, 134, 90 | provider/model configuration, pen names, sessions, account export/delete; Users/ModelConfig APIs | loading / error / disabled / permission / partial / rate-limit | `prototype/screens/v1-baseline/account-settings-{390,900,1180,1440}.png` | `apps/web/e2e/parity/account-settings.spec.ts`, `apps/web/e2e/parity/m1-closeout.spec.ts` | `artifacts/ui/golden/account-settings/account-settings-{390,900,1180,1440}.png` | production-built |
| help | #help | /help | M3 | #131 | 104 | help/FAQ content and navigation; static content contract | static / empty / error | `prototype/screens/v1-baseline/help-{390,900,1180,1440}.png` | `apps/web/e2e/parity/help.spec.ts` | `artifacts/ui/golden/help/help-{390,900,1180,1440}.png` (after author sign-off) | production-pending |
| legal | #legal | /legal/* | M3 | #131 | 104 | privacy/terms/AI disclosure/appeal content; static + moderation contract | static / error | `prototype/screens/v1-baseline/legal-{390,900,1180,1440}.png` | `apps/web/e2e/parity/legal.spec.ts` | `artifacts/ui/golden/legal/legal-{390,900,1180,1440}.png` (after author sign-off) | production-pending |
| states | `#states` | none — excluded from production | prototype-only | — | — | prototype state gallery only | normal / empty / loading / error / disabled / permission / partial / long / locked / readonly / conflict | `prototype/screens/v1-baseline/states-{390,900,1180,1440}.png` | — | — | prototype-only |

> 2026-11-10：作者完成 M1 页面视觉方向签收，覆盖 work-overview、bible、settings、entity-detail、outline、foreshadows、writing、account-settings 的 390 / 900 / 1180 / 1440 四档。签收记录见 `docs/ui/v1-prototype-signoff.md`；#172 生成 entity-detail 与 foreshadows 的 8 张当前正式 Golden，生成证据为 [Production CI #42670999022](https://github.com/ruifeng-y/novel-brain/actions/runs/42670999022)，正常视觉回归证据为 [Production CI #42682407291](https://github.com/ruifeng-y/novel-brain/actions/runs/42682407291)；#176 生成 work-overview 正常态与长内容态 8 张当前正式 Golden，生成证据为 [Production CI #42810925879](https://github.com/ruifeng-y/novel-brain/actions/runs/42810925879)，但 WORK-009 的全站作品与平行版本切换一致性仍由 #95、#123 跟踪。其余 5 页的 20 张当前 Golden 与完整状态证据由 #174 跟踪。
>
> #145 将 outline 扩展为五层大纲、卷契约和场景卡；当前生产布局已完成作者视觉签收，自动化 Golden 比较仍由 #174 跟踪。
>
> entity-detail 按原型保持独立整页，而不是设定中心右侧详情栏：页面结构为返回按钮、档案 Hero、左侧五段目录和右侧分区内容，URL 使用 `?column=<column>&entityId=<entityId>` 保留可回退的详情状态。
>
> 2026-11-07 M1 结构审计修复了 work-overview（补回三列 Hero、统计卡、最近章节、快捷入口）和 settings（补回搜索、状态筛选、最近更新）的未授权结构漂移；详细对照见 `docs/ui/m1-parity-audit.md`。两页当前布局已完成作者视觉签收；work-overview 的自动 Golden 比较由 #176 补齐，settings 仍由 #174 跟踪。
>
> #146 为 outline 增加剧情账本视图，并新建 foreshadows 生产页；两页均已完成作者视觉签收。foreshadows 已有四档 Golden 比较，但 `loading` 状态仍由 #174 跟踪。

> #147 在 outline 增加黄金三章候选比较、作者选择、六维失败阻断、例外理由和锁定后风格基线。生产动作与 `apps/web/e2e/parity/golden-three.spec.ts` 四档视口证据已落地，当前布局已完成作者视觉签收。
>
> #162 将黄金三章拆为两阶段：候选只固定第 1 章，作者选定后登记第 2、3 章续写，续写节点存在后才允许锁定；`apps/web/e2e/parity/golden-three.spec.ts` 已覆盖该门禁。
>
> outline 的“规划张力（0–100）”字段已由作者批准保留：它用于驱动张力曲线、观察章节/场景节奏起伏，不是质量评分。原型节点编辑器和 V1 需求字段清单已同步补入该字段；生产标签与帮助文案同步为“规划张力”。
>
> 2026-11-07：outline 结构审计补回左侧卷列表、中央卷章节列表和黄金三章页内区块，移除黄金三章第 5 个 tab；章节/场景编辑表单仍留在中央以保证宽度，右侧保留准备度/新增节点。当前生产布局已由作者完成视觉签收，自动化 Golden 比较仍由 #174 跟踪。
>
> outline 的账本视图生产为三列总览（剧情线 / 伏笔 / 人物弧），原型为三个子 tab；当前生产实现已由作者完成视觉签收，不再作为待决项。
>
> #117 在 writing 增加真实“检查本章”、六维证据、结构化 Finding、P0/P1 门禁和 P2/P3 忽略理由/恢复生命周期。`apps/web/e2e/parity/writing.spec.ts` 已覆盖四档视口，当前布局已纳入 M1 Golden 签收。
>
> #119 在 work-overview 增加声线/文风基线批准与跨卷趋势，在 writing 增加单章漂移、证据定位和成长依据。`apps/web/e2e/parity/work-overview.spec.ts` 与 `apps/web/e2e/parity/writing.spec.ts` 已覆盖四档视口，两页当前布局均已完成作者视觉签收；work-overview 的自动 Golden 比较由 #176 补齐，writing 仍由 #174 跟踪。
> #118 在 writing 增加低中风险问题选择、定向修订轮次、前后差异、未解决项和作者接受/拒绝/再改写反馈。`apps/web/e2e/parity/writing.spec.ts` 已覆盖两轮边界外的真实修订与事实提交门禁反例，当前布局已纳入 M1 Golden 签收。
>
> 2026-11-07：writing 右侧信息区已按原型改为 9 个 tab（编辑建议 / 本章参考 / 连续性 / 伏笔 / 事实 / 人物 / 质量 / 生成 / 版本），所有 tab 仍消费真实 API；伏笔和人物 tab 新增读取 `/ledger`、`/entities`。左侧卷导航/搜索和顶部题材规则条已补齐；原型题材切换按钮属于演示内容，不进入生产。编辑建议 tab 复用真实质量/修订面板，当前生产布局已由作者完成视觉签收，自动化 Golden 比较仍由 #174 跟踪。
>
> #90 在 work-overview 增加真实卷末审计：选择卷、运行审计、定位章节/账本证据、记录作者通过或要求修改。`apps/web/e2e/parity/m1-closeout.spec.ts` 对 bible/settings/entity-detail/outline/foreshadows/writing/work-overview/account-settings 做四档视口、作者语言和溢出检查。作者视觉签收已记录；#172 补齐 entity-detail/foreshadows 的自动 Golden 比较，#176 补齐 work-overview，#174 补齐其余页面及必需状态证据。

## 4. UI issue ownership rules

- Primary page issue must update this row as implementation progresses: production-pending → production-built → parity-verified (or deviation-approved).
- Supporting feature issues must add action/API/state evidence to the page spec and must not declare the whole page parity-verified on their own.
- Package issues #85/#88/#89/#94/#95/#96/#98–#103 integrate cross-page work; they are not substitutes for primary leaf owners.
- #104 is the global closeout for all 17 production page rows; #79 closes the M0 subset. Both aggregate evidence and may not fabricate missing page evidence.
- Entity detail is a full-page state inside the Settings route, selected by `?column=<column>&entityId=<entityId>`; it is not a separate route. It remains a distinct page contract/state surface because the prototype contains a separately testable page panel.
- states is prototype-only and does not count as a production route or release page.

## 5. Page completion checklist

A page cannot transition to parity-verified until all applicable checks pass:

1. Production route loads with the correct authenticated/unauthenticated shell, selected work and selected branch context.
2. Every primary action invokes the real API/Worker contract and produces a persistent, observable result.
3. Loading, empty, error, disabled, permission, partial, conflict, locked, long-content and stale-version states are tested where applicable; each has a clear recovery path.
4. Playwright exercises the page's primary actions and gate transitions against deterministic integration fixtures.
5. The page spec runs at 1440, 1180, 900 and 390 and asserts no horizontal overflow.
6. Production screenshots are captured from a real running production page using the fixed browser/font environment and compared against prototype references.
7. Author signs off the initial production golden; subsequent visual drift is CI-blocking unless a deviation is approved.
8. Author-language scan and prototype_only leakage scan pass.
9. Page issue links the run, screenshots, route, API contracts and sign-off record.

## 6. Prototype baseline regression

Prototype regression remains useful as a separate design-contract test:

```bash
cd prototype
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:parity
```

Test source: prototype/tests/parity.spec.ts. The current prototype suite is documented as 49 assertions across 18 pages and four viewports. It validates the prototype, not the future production application.

## 7. Production parity entry points

The owning page issue creates its parity spec at apps/web/e2e/parity/<page>.spec.ts and adds a documented command to run it. The expected screenshot output root is artifacts/ui/golden/. Do not commit empty placeholder images or copy prototype screenshots into the production golden folder. If the production package path changes, update this contract before implementation proceeds; do not silently rename or omit the evidence.

## 8. M0 closeout evidence

`apps/web/e2e/parity/m0-closeout.spec.ts` runs the full author journey and a consolidated M0 page pass at 390, 900, 1180 and 1440. The active Golden comparisons in that pass cover auth, dashboard and new-project. account-settings, work-overview, bible, settings, outline and writing are exercised for route, author language and overflow but use attachment screenshots in the current pass. The historical Linux/Chromium M0 baseline evidence is [Production CI #42005502769](https://github.com/ruifeng-y/novel-brain/actions/runs/42005502769).

The nine M0 pages received their initial author approval on 2026-11-05 and their 36 production golden files are committed. Pages changed after that closeout must satisfy the current page row and active comparison requirements; the historical M0 signoff does not override later evidence gaps. Automation alone does not approve future baseline changes.

## 9. M1 closeout evidence

`apps/web/e2e/parity/m1-closeout.spec.ts` covers the integrated M1 author loop and the eight M1 acceptance pages at 390, 900, 1180 and 1440. `entity-detail.spec.ts`, `foreshadows.spec.ts` and `work-overview.spec.ts` add normal `toHaveScreenshot` comparisons including the production routes, page titles, primary actions, representative states, author language and no-horizontal-overflow checks.

#172 adds eight current formal M1 Golden files under `artifacts/ui/golden/entity-detail/` and `artifacts/ui/golden/foreshadows/`; #176 adds eight normal/long `work-overview` baselines. The Linux/Chromium baseline update evidence is [Production CI #42670999022](https://github.com/ruifeng-y/novel-brain/actions/runs/42670999022), and the normal PR screenshot comparison evidence is [Production CI #42682407291](https://github.com/ruifeng-y/novel-brain/actions/runs/42682407291). The other 20 page-named files predate the current M1 layouts and are not treated as active baselines.

The author approved the visual direction of the eight M1 acceptance pages on 2026-11-10. All eight remain `production-built`: #174 must add active `toHaveScreenshot` comparisons for five pages, regenerate their 20 formal files, add the `foreshadows` loading state and complete `prototype_only` leakage evidence for `entity-detail`. Automation alone does not approve future baseline changes.
