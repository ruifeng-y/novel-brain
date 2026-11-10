# M1 页面结构 Parity Audit

> 日期：2026-11-07
> 方法：在 1440 视口同时加载 `prototype/index.html` 与生产路由，对比主内容层级、`grid-template-columns` 和关键区块；再用 Playwright 在 390 / 900 / 1180 / 1440 检查横向溢出与关键文案。
> 判定原则：没有签收记录的生产结构偏离按缺陷修复；已批准范围扩展保留功能，但必须先更新原型 / parity matrix / 签收记录；原型演示内容不进入生产。

## 1. 审计结果

| 页面 | 原型结构 | 生产结构（审计时） | 判定 | 处理 |
| --- | --- | --- | --- | --- |
| work-overview | 3 列 Hero + 统计卡 + 准备度 + 最近章节 + 快捷入口 | 2 列 Hero，缺统计卡、最近章节和快捷入口 | 未授权结构漂移 | 已修复：恢复 3 列 Hero、6 张真实统计卡、最近章节和快捷入口；保留声线 / 卷末审计新面板 |
| bible | 3 列：卡片导航 / 主区 / 右栏 | 3 列：`232px / 580px / 280px` | 结构一致 | 无需结构修复；作者视觉签收通过，自动化 Golden 比较由 #174 跟踪 |
| settings | 2 列 shell + 搜索 / 状态筛选 / 最近更新 | 2 列 shell，缺 toolbar 和最近更新 | 未授权结构漂移 | 已修复：补搜索、状态筛选、最近更新和新增入口 |
| outline | 页头 + 4 个视图 tab + 左侧树/卷列表 + 中央卷章节列表 + 右侧章节详情/准备度 + 黄金三章页内区块；账本为 3 个子 tab | 页头 + 4 个视图 tab + 左侧树/卷列表 + 中央卷章节列表与编辑表单 + 右侧准备度/新增节点 + 黄金三章页内区块；账本为 3 列总览 | 主要结构已对齐；编辑表单位置和账本呈现是已签收的生产适配 | 已修复卷列表、章节列表、黄金三章位置和 tab 数量；表单与三列总览纳入作者视觉签收；自动化 Golden 比较由 #174 跟踪 |
| foreshadows | 4 张统计卡 + 2 列账本区 | 4 张统计卡 + 2 列账本区 | 结构一致 | 无需结构修复 |
| writing | 3 列编辑区；顶部题材规则条；右侧 9 个 tab；左侧章节列表/卷导航/搜索/状态 | 3 列编辑区；生产页头 + 真实题材规则条；右侧 9 个 tab；左侧章节列表/卷选择/搜索/状态 | 主要结构已对齐；编辑建议 tab 的卡片排版仍有差异 | 已补齐右侧 tab、左侧卷导航/搜索和题材规则条；原型题材切换按钮属于演示内容，不进入生产 |
| account-settings | 2×2 账号卡片 | 2 列模型卡 + 2 列账号卡 | 结构一致；模型与会话是 M1 已批准范围 | 保留功能并纳入作者视觉签收；自动化 Golden 比较由 #174 跟踪 |
| entity-detail | 独立整页：返回按钮 + Hero + 5 段目录 + 分区内容 | 原为设定中心右侧详情栏 | 未授权结构漂移 | 已修复为独立整页，URL 使用 `?column=<column>&entityId=<entityId>` |

## 2. 本轮修复

- entity-detail：移除 `.settings-detail-rail`，改为独立整页；1440 下左侧目录 `220px`、主内容 `892px`，右侧详情栏数量为 0。
- work-overview：恢复原型的三列 Hero、6 张统计卡、最近章节和快捷入口；统计使用真实章节、设定和伏笔数据，不写死演示数字。
- settings：恢复搜索、状态筛选和最近更新；筛选只作用于当前栏目，清空后恢复全部实体。
- outline：作者批准保留“规划张力（0–100）”；生产标签、帮助文案、原型节点编辑器、V1 需求字段清单和实现文档已同步，明确它是节奏观察值，不是质量评分。

## 3. 证据

- `apps/web/e2e/parity/entity-detail.spec.ts`：11/11 通过。
- `apps/web/e2e/parity/settings.spec.ts`：8/8 通过（含搜索、状态筛选和最近更新入口）。
- `apps/web/e2e/parity/work-overview.spec.ts`：4/4 通过。
- `apps/web/e2e/parity/outline.spec.ts`：4/4 通过（含规划张力字段和帮助文案）。
- `apps/web/e2e/parity/golden-three.spec.ts`：1/1 通过（黄金三章页内区块）。
- `apps/web/e2e/parity/writing.spec.ts`：12/12 通过（右侧 9 个 tab、真实质量/事实/修订/版本/生成链路）。
- `apps/web/e2e/parity/m1-closeout.spec.ts`：2/2 通过。
- 1440 结构：work-overview Hero `130px / 692px / 220px`，统计区 `4 × 273px`；settings 工具栏和最近更新存在，shell 为 `220px / 892px`。
- 390 结构：上述页面横向溢出均为 `0`。
- 候选截图：
  - `artifacts/ui/candidates/m1/work-overview-parity-{1440,390}.png`
  - `artifacts/ui/candidates/m1/settings-parity-{1440,390}.png`
  - `artifacts/ui/candidates/m1/entity-detail-parity-{1440,390}.png`
  - `artifacts/ui/candidates/m1/outline-planning-tension-{1440,390}.png`
  - `artifacts/ui/candidates/m1/outline-workspace-parity-{1440,390}.png`
  - `artifacts/ui/candidates/m1/writing-workspace-aligned-{1440,390}.png`
  - `artifacts/ui/candidates/m1/m1-signoff-overview.png`（8 页 × 4 档总览）
- 2026-11-07 作者已确认 `2adc945` 的 8 页 × 4 档候选截图（清单见 `artifacts/ui/candidates/m1/m1-capture-results.json`）；该确认不替代正式 Linux/CI golden 比对签收。

## 4. 签收后的自动化剩余事项

2026-11-10：作者已完成 8 个 M1 验收页面的视觉方向签收，接受当前生产结构及其已批准适配，没有新增未批准项。`entity-detail` 与 `foreshadows` 已有当前正式 Golden；其余 24 张与完整状态证据由 #174 跟踪。签收记录见 `docs/ui/v1-prototype-signoff.md`。

1. account-settings 的模型配置、设备会话和账号安全属于 M1 已批准范围，当前生产布局已纳入视觉签收；自动化 Golden 比较由 #174 跟踪。
2. writing 的题材规则条属于原型演示内容；生产保留页头，不复制题材演示控件。当前生产布局已纳入视觉签收。
3. outline 的“规划张力（0–100）”字段已由作者批准保留，用于驱动张力曲线和观察节奏起伏，不是质量评分；原型、需求、实现文档和 parity matrix 已同步。
4. outline 的章节/场景编辑表单放在中央章节列表下方，右侧保留准备度和新增节点；该生产适配已纳入视觉签收。
5. outline 的账本视图生产为三列总览，原型为“剧情线账本 / 伏笔账本 / 人物弧光”三个子 tab；当前生产实现已纳入视觉签收，不再作为待决项。
6. writing 的“编辑建议”tab 复用真实质量/修订面板；当前生产布局已纳入视觉签收，题材切换按钮属于原型演示内容，不进入生产。
7. `entity-detail` 与 `foreshadows` 的四档 `toHaveScreenshot` 比较已由 #172 补齐；#174 继续补 `foreshadows` 的 `loading` 状态、`entity-detail` 的 `prototype_only` 泄漏证据，以及 work-overview、bible、settings、outline、writing 和 account-settings 的当前 Golden 比较。完成前，8 个页面均保持 `production-built`。

## 5. 后端逻辑核对

| 页面 | 新增 UI 数据/动作 | 后端来源 | 是否新增后端逻辑 |
| --- | --- | --- | --- |
| work-overview | 累计字数、章节数、已确认设定、待处理提醒、准备度、未回收伏笔、最近章节、快捷入口 | 既有 `/chapters`、`/entities`、`/ledger`、`/readiness`、`/style` | 不需要新增；UI 改为读取真实接口，不再写死统计 |
| settings | 搜索、状态筛选、最近更新 | 既有 `/entities` | 不需要新增；筛选和排序在客户端基于真实实体数据 |
| outline | 卷列表、当前卷章节列表、规划张力 | 既有 `/outline`；`outline_nodes.tension`、`scene_cards.tension`；`apps/api/src/outline/outline.service.ts` 与 repository | 不需要新增；张力列和持久化已存在，仅补 UI 和文档 |
| entity-detail | 全页档案、关系、历史、引用、体检 | 既有设定/人物/势力/地图/力量/物品/时间线 API | 不需要新增；页面改为全页消费既有接口 |
| writing | 右侧 9 个 tab；伏笔/人物 tab；工具栏检查入口 | 既有 generation、writing-actions、review、facts、revisions、chapters；新增读取 `/ledger`、`/entities` | 不需要新增写操作；只新增两个只读数据源，所有生成/检查/批准/提交仍走原有真实 API/Worker |
