# M1-06d 人物声线、风格基线与跨卷漂移

> Issue: #119
> Capability ID: QUALITY-008
> UI parity matrix: writing, work-overview

## 交付范围

- 新增可追溯 `style_profiles`：来源、来源版本、版本节点、作用域、维度、批准状态、批准人和批准理由均为显式字段。
- 基线支持作品文风与人物声线；只有 `approved` 基线参与漂移检查，未批准草稿会返回 `STYLE_BASELINE_UNAPPROVED`。
- `author_sample` 必须由作者显式批准；`approved_chapter_version` 只接受已批准、已锁定或已发布章节；`golden_three` 只接受 #147 已锁定黄金三章生成的风格基线，不会从未锁定候选自动升级。
- 漂移检查支持单章、卷内章节窗口和跨卷章节窗口。报告记录模型、模型参数、提示版本、基线版本、规则版本、源内容哈希与逐章趋势。
- 角色弧有效窗口内的、方向与成长变化一致的高强度声线变化记录为“有依据的成长”；没有匹配角色弧的变化仍按漂移报告。
- 报告按段落定位原文、保存证据 quote/offset/locator，只提供修改建议，不写入或覆盖任何章节正文。

## 数据与迁移

- `packages/db/migrations/0039_m1_119_style_drift.sql`
- 新增 `style_profiles`、`style_drift_reports`、`style_drift_findings`。
- 三张表均启用并强制 RLS；基线与报告使用 `user_id/work_id/branch_id` 租户键。
- 基线和批准动作追加单一版本图节点；报告为派生审校记录，不进入故事版本图。

## API

- `GET /works/:workId/branches/:branchId/style`
- `POST /works/:workId/branches/:branchId/style/profiles`
- `POST /works/:workId/branches/:branchId/style/profiles/:profileId/approve`
- `POST /works/:workId/branches/:branchId/style/drift`

## UI

- `apps/web/components/work-overview.tsx` 增加基线来源/版本/批准状态、作者批准动作和跨卷趋势检查。
- `apps/web/components/writing-workspace.tsx` 增加单章声线检查、证据段落、成长依据与“定位证据”；定位只选中正文范围，不自动改写。
- `apps/web/components/style-drift-findings.tsx` 统一作者语言 findings 展示。
- `apps/web/e2e/parity/work-overview.spec.ts` 与 `apps/web/e2e/parity/writing.spec.ts` 覆盖真实 API 动作、证据定位、成长区分与 390/900/1180/1440 四档无横向溢出。
- 两个页面仍为 `production-built`；新增布局需要按 ADR 0027 重新拍摄 golden 并由作者签收。

## 验证接缝

- `packages/contracts/test/style-drift.test.ts`：来源、版本、作用域、维度、批准信息、检查窗口和报告 provenance。
- `packages/core/test/style-drift.test.ts`：单章漂移、跨卷趋势、段落证据与角色成长豁免。
- `apps/api/test/style-drift.integration.test.ts`：专用 `novelbrain_test_119_<随机后缀>` 与独立 Redis DB，覆盖批准门禁、单章/卷/跨卷报告、正文不变、版本节点和跨租户拒绝。
- Playwright：overview 基线批准与跨卷 findings；writing 单章 findings、定位证据和正文不变。

## 已知风险

- 当前检测是确定性启发式基线，主要观察感叹率、句长和对话密度；复杂反讽、不可靠叙述和细腻语体变化仍需作者判断。
- 角色成长豁免依赖已登记的人物弧方向；未登记的角色成长会先报告为漂移，作者可在确认后补充人物弧证据。
- 自动检查不会调用模型，也不会自动改写正文；未来若接入模型评估，必须沿用报告的模型/提示/基线版本 provenance。
