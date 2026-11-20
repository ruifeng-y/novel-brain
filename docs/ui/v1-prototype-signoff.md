# V1 原型基线签收

> 日期：2026-11-04
> 状态：**V1 UI 基线已签收**
> 签收对象：`prototype/` 的 18 个页面与主流程交互
> 证据：Playwright 回归断言、18 页 × 4 档共 72 张 Chromium 截图、逐页状态矩阵

## 签收范围

- 7 个设定栏目、3 个题材、1000 万字与 30–40 卷示例。
- 新建作品的想法、空白、题材模板、设定导入、旧稿导入五种入口。
- 故事圣经、大纲、写作台、批量生产、修改版本、导出发布、账号与模型设置。
- 章节批准、事实确认、本章事实提交三段动作。
- 高风险门禁：冲突、合并、锁定内容、六维评审、导入冲突、导出后删除。
- 1440 / 1180 / 900 / 390 四档响应式与页面内状态面板。

## 2026-11-05 生产 Golden 基线签收

签收人：ruifeng-y。作者已确认 M0 九个生产页面在 390 / 900 / 1180 / 1440 四档视口下的初始生产截图，并同意将其作为后续视觉回归基线。覆盖页面：auth、dashboard、new-project、account-settings、work-overview、bible、settings、outline、writing。

生产截图来自真实生产 Web 路由与确定性验收数据，不复制原型图片。Golden 文件位于 `artifacts/ui/golden/<page>/<page>-<viewport>.png`，由 `apps/web/e2e/parity/m0-closeout.spec.ts` 使用 0.5% 像素差异容忍度进行比对。Linux/Chromium 基线更新证据：[Production CI #42005502769](https://github.com/ruifeng-y/novel-brain/actions/runs/42005502769)。该签收只覆盖 M0 九页；M1–M3 页面仍需按 ADR 0027 单独完成生产截图、比对和作者签收。

## 不包含

- 真实后端数据、真实模型调用和真实大文件解析。
- 完整组件变体和像素级视觉 diff。
- 发布环境的内容合规、性能和恢复演练。

这些由实现阶段和发布门禁验收，不回退原型签收状态。

## 2026-11-05 M1 故事圣经生产变更

Issue #143 在生产故事圣经页面加入结构化世界铁律、版本历史、锁定修改请求和显式解锁入口。当前状态为**待作者视觉重新签收**：`apps/web/e2e/parity/bible.spec.ts` 已覆盖 proposal/edit/conflict/locked/long 与四档视口，但 `artifacts/ui/golden/bible/` 尚未按 ADR 0027 重新生成和签收。在签收完成前，不将本页状态提升为 `parity-verified`。

2026-11-06：产品负责人明确同意先推进 M1 其余实现，bible 视觉签收延后并回补；#143 保持未关闭，生产 golden 不得冒充已签收基线。

## 2026-11-06 M1 页面与卷末审计待签收

Issue #90 已完成卷末审计、固定仙侠样片、M1 全链路 E2E 和 M1 页面 parity 的自动化检查，但以下生产页面仍需作者视觉签收：work-overview、bible、settings、entity-detail、outline、foreshadows、writing、account-settings。

`apps/web/e2e/parity/m1-closeout.spec.ts` 只附加真实生产截图作为待签收证据，不执行 golden 对比，也不代替作者签收。卷末审计的作者签收记录也尚未产生；集成测试中的签收只验证状态机和审计日志，不构成产品验收。

2026-11-07：完成 M1 页面结构审计，修复 entity-detail 右侧详情栏、work-overview 缺失 Hero 第三列 / 统计卡 / 最近章节 / 快捷入口、settings 缺失搜索 / 状态筛选 / 最近更新这三类未授权结构漂移。审计记录见 `docs/ui/m1-parity-audit.md`；上述页面的生产 golden 与作者视觉签收仍待完成。

2026-11-07：作者批准保留 outline 的“规划张力（0–100）”字段。该字段用于驱动张力曲线、观察章节和场景的节奏起伏，不是质量评分；原型节点编辑器、V1 需求字段清单、实现文档和 parity matrix 已同步。

2026-11-07：outline 结构审计补回左侧卷列表、中央卷章节列表和黄金三章页内区块，移除黄金三章第 5 个 tab。章节/场景编辑表单仍留在中央以保证可用宽度，右侧保留准备度和新增节点；账本视图生产为三列总览，原型为三个子 tab。上述适配待作者视觉签收确认。

2026-11-07：writing 右侧信息区按原型改为 9 个 tab，所有 tab 继续消费真实质量、事实、修订、版本、生成接口；伏笔/人物 tab 新增读取真实账本和人物档案。左侧卷导航/搜索和顶部题材规则条已补齐；原型题材切换按钮属于演示内容，不进入生产。编辑建议 tab 目前复用真实质量/修订面板，静态建议卡排版待签收确认。

2026-11-07：作者确认 `2adc945` 的 M1 候选截图，覆盖 work-overview、bible、settings、entity-detail、outline、foreshadows、writing、account-settings 共 8 页 × 390 / 900 / 1180 / 1440 四档视口（`artifacts/ui/candidates/m1/`）。该确认只针对页面结构与布局；正式 Linux/CI golden 仍需按 ADR 0027 重新拍摄并由作者完成 golden 比对签收，在完成前上述页面不得提升为 `parity-verified`。

## 2026-11-06 M1 黄金三章生产变更

Issue #147 在 outline 页加入黄金三章候选比较、六维评分与证据、作者选择、失败阻断、例外锁定和风格基线。`apps/web/e2e/parity/golden-three.spec.ts` 已覆盖四档视口与真实 API 动作；现有 outline 生产 golden 已不代表新布局，需在 M1 布局稳定后重新拍摄并完成作者视觉签收。

## 2026-11-10 M1 页面视觉方向签收与 Golden 证据

签收人：ruifeng-y。

作者已确认以下 8 个 M1 验收页面在 390 / 900 / 1180 / 1440 四档视口下的视觉方向，并同意当前生产布局。当前正式 Linux/CI Golden 的生成范围见下文：

- work-overview
- bible
- settings
- entity-detail
- outline
- foreshadows
- writing
- account-settings

Golden 文件位于 `artifacts/ui/golden/<page>/<page>-<viewport>.png`。作者本次对 8 个页面的视觉方向作出签收；其中 #172 为 `entity-detail` 与 `foreshadows` 生成 8 张正式 Linux/CI Golden，#174 为 `bible`、`settings`、`outline`、`writing` 与 `account-settings` 生成 20 张代表性生产状态 Golden，#176 为 `work-overview` 生成正常态与长内容态共 8 张正式 Linux/CI Golden，#177 为 `account-settings` 生成 4 张 Key 错误态 Golden。8 个 M1 验收页面现在都有当前正式视觉基线。全量生成证据见 [Production CI #42948984698](https://github.com/ruifeng-y/novel-brain/actions/runs/42948984698)。

本次视觉判断没有未批准项，也没有新增产品偏差。它取代前文 2026-11-05 至 2026-11-07 对 M1 页面视觉方向的待签收状态，但不替代其余页面尚未生成的正式 Golden 证据。

#172、#174、#176 与 #177 合计补齐 8 个 M1 验收页面的真实生产路由四档 `toHaveScreenshot`、当前正式 Golden、`prototype_only` 泄漏扫描与必需状态证据。#174 额外补齐 `foreshadows` 的 `loading` 状态与 `entity-detail` 的结构化扫描附件。正常 Linux 截图比较以本 PR 最终绿色 Production CI 为准；合并前不得把未通过正常回归的页面标记为完成。

## 2026-11-10 Work Overview 分支与长内容证据

签收人：ruifeng-y。#176 补齐 `work-overview` 的当前作品/主线壳层上下文、待处理与最近修改列表，以及真实长作品名、长摘要、长章节和长设定证据。正常态与长内容态均在 390 / 900 / 1180 / 1440 四档视口下执行 `toHaveScreenshot`，并覆盖作者语言、prototype_only 扫描和无横向溢出断言。作者确认 8 张 Linux/CI Golden 作为当前视觉基线，生成证据为 [Production CI #42810925879](https://github.com/ruifeng-y/novel-brain/actions/runs/42810925879)。本次证据只覆盖 `work-overview` 生产路由；全站当前作品与平行版本切换一致性仍由 #95、#123 跟踪，不声称 WORK-009 全站完成。单票记录不提升整页；#174 完成其余页面和状态证据后统一进入 `parity-verified`。

## 2026-11-10 Account Settings Key 错误态证据

签收人：ruifeng-y。#177 补齐 `account-settings` 的 Key 无效、失效、连接测试失败、掩码保持、失败后替换 Key 与重试恢复证据；原型账号页同步登记掩码错误行与“替换 Key”动作。正常态生产 Golden 不变；错误态在 390 / 900 / 1180 / 1440 四档视口下执行 `toHaveScreenshot`，并覆盖作者语言、prototype_only 扫描和无横向溢出断言。作者确认 4 张错误态 Linux/CI Golden 作为当前状态基线，生成证据为 [Production CI #42780689501](https://github.com/ruifeng-y/novel-brain/actions/runs/42780689501)，正常 Linux 回归以 PR #178 的最终绿色 Production CI 为准。账号导出、注销恢复期与永久删除仍由 #134 独立跟踪，本记录不提升整页状态。

## 2026-11-11 Remaining M1 Golden 与状态证据

签收人：ruifeng-y。#174 为 `bible`、`settings`、`outline`、`writing` 与 `account-settings` 补齐四档真实生产路由 `toHaveScreenshot`，生成 20 张代表性生产状态 Linux/CI Golden；同时补齐 `foreshadows` 的 `loading` 状态和 `entity-detail` 的 `prototype_only` 泄漏扫描附件。生成证据为 [Production CI #42948984698](https://github.com/ruifeng-y/novel-brain/actions/runs/42948984698)。8 个 M1 验收页面在正常 Linux 回归通过后进入 `parity-verified`；本记录不扩张到 work-settings、M2 或 M3 页面。

## 2026-11-11 M2 Genre Pack settings/bible Golden 签收

签收人：ruifeng-y。作者已确认 `artifacts/ui/candidates/m2-92/` 中 `settings` 与 `bible` 的 390 / 900 / 1180 / 1440 四档候选截图。

正式 Linux/CI Golden 由 [Production CI #43024840541](https://github.com/ruifeng-y/novel-brain/actions/runs/43024840541) 的 `update_golden` 任务生成并上传 `playwright-evidence` artifact。`settings` 的 4 张正式 Golden 已更新；`bible` 的 4 张经当前回归确认保持既有正式基线。最终正常 PR CI 通过后，`bible` 与 `settings` 进入 `parity-verified`。

该记录最初只覆盖 `settings`/`bible`；2026-11-12 的后续签收将范围扩展到 `new-project` 与 `entity-detail`，其他 M2 页面仍不在本次范围。

## 2026-11-12 M2 Genre Pack 四页正式 Golden 签收

签收人：ruifeng-y。作者确认 `artifacts/ui/candidates/m2-92/` 的四档视觉签收覆盖 new-project、settings、bible 与 entity-detail 的题材化变化。

settings、bible、entity-detail 的 12 张正式 Golden 已按当前生产渲染更新；new-project 的现有正式 Golden 经四档回归继续有效。`new-project.spec.ts`、`settings.spec.ts`、`bible.spec.ts`、`entity-detail.spec.ts` 均使用真实生产路由和确定性数据，覆盖 390 / 900 / 1180 / 1440、作者语言、无横向溢出及 `toHaveScreenshot`。最终 PR CI 通过后四页保持 `parity-verified`。

## 2026-11-12 M2 batch/changes 视觉签收

签收人：ruifeng-y。作者确认 M2 batch 与 changes 页面采用当前生产布局，并要求在解决所有门禁后合并；本次后续指令未提出视觉结构偏差。

Batch Golden 覆盖暂停、失败、成本硬停、审核决策部分失败和四档视口。Changes Golden 覆盖 390 / 900 / 1180 / 1440，语义测试同时覆盖加载、错误、冲突、部分失败、禁用应用、旧版本拒绝、当前作品/全部作品搜索与选中平行版本上下文。正式 Linux `toHaveScreenshot` 以最终 PR 的绿色 Production CI 为准；合并前不得用本地截图替代该回归证据。

## 2026-11-20 batch 任务中心视觉签收

签收人：ruifeng-y。作者确认 `artifacts/ui/candidates/m3-230-batch/` 中 `batch-{390,900,1180,1440}.png` 四张 Linux/Chromium 候选，并同意将其作为当前正式 Golden。

候选由受控 Production CI [44723219024](https://github.com/ruifeng-y/novel-brain/actions/runs/44723219024) 的 `update_golden` 任务生成；四张正式文件已写入 `artifacts/ui/golden/batch/`。新布局加入批量任务发现、开始/暂停/恢复/取消/重试、按需成本报告和审核队列组合。`apps/web/e2e/parity/batch.spec.ts` 的七个动作、四档截图、作者语言、`prototype_only` 扫描和语义断言由正常 PR Production CI [44731154154](https://github.com/ruifeng-y/novel-brain/actions/runs/44731154154) 与 Deployment Smoke [44731154093](https://github.com/ruifeng-y/novel-brain/actions/runs/44731154093) 验证通过，页面已提升为 `parity-verified`。

## 2026-11-20 changes 动作证据与视觉复核

`#231` 为 changes 补齐新建、分析、应用、撤销、平行版本、逐对象比较和选择性摘取的真实 API 与持久化证据。受控 Production CI [44745195527](https://github.com/ruifeng-y/novel-brain/actions/runs/44745195527) 生成 `changes-{390,900,1180,1440}.png` 四张 Linux/Chromium 候选；其文件哈希与现有正式 Golden 完全一致，因此无需修改基线，原 2026-11-12 视觉签收继续有效。

正常 PR Production CI [44748955254](https://github.com/ruifeng-y/novel-brain/actions/runs/44748955254) 与 Deployment Smoke [44748955239](https://github.com/ruifeng-y/novel-brain/actions/runs/44748955239) 通过后，changes 提升为 `parity-verified`。

## 2026-11-16 account-settings 账号生命周期视觉签收

签收人：ruifeng-y。作者确认 `artifacts/ui/candidates/m3-134-linux/artifacts/ui/golden/account-settings/` 中账号设置常规态与 Key 错误态各四档，共 8 张 Linux candidate 作为正式 Golden。

这 8 张 Golden 覆盖数据与隐私 panel、账号导出入口和导出前删除禁用；30 天恢复页、partial failure、恢复后再次注销和 fresh-login 恢复由同一 Playwright spec 的语义断言覆盖。8 张正式 Golden 已复制到 `artifacts/ui/golden/account-settings/`。Linux 生成证据为 [Production CI #43836291876](https://github.com/ruifeng-y/novel-brain/actions/runs/43836291876) 的 `update_golden` Playwright artifact；最终正常 PR CI 必须再次通过四档 `toHaveScreenshot`、作者语言、无横向溢出和真实行为测试后才合并。

## 2026-11-17 export-publish 视觉签收

签收人：ruifeng-y。作者确认 `artifacts/ui/candidates/m3-130-export-publish/` 中导出与发布页的 390 / 900 / 1180 / 1440 四档候选截图，并同意将其作为正式 Golden。

正式文件写入 `artifacts/ui/golden/export-publish/`。截图来自真实生产路由、真实导出/worker receipt 和固定发布预览数据，覆盖目录、导出历史、发布检查、元数据入口、当前作品/创作线上下文与无横向溢出。真实行为、读者预览焦点管理、stale/regenerate、租户隔离和过期恢复由 `apps/web/e2e/parity/export-publish.spec.ts` 覆盖。Linux/Chromium Golden 生成证据为 [Production CI #44019894890](https://github.com/ruifeng-y/novel-brain/actions/runs/44019894890) 的 `update_golden` Playwright artifact；最终正常 PR CI 必须再次通过四档 `toHaveScreenshot`、作者语言、`prototype_only` 扫描和语义断言后才合并。

## 2026-11-17 help/legal/export-publish AI 标识与申诉视觉签收

签收人：ruifeng-y。作者确认 `artifacts/ui/candidates/m3-131/` 中 `help`、`legal` 与改版 `export-publish` 的 390 / 900 / 1180 / 1440 四档共 12 张 Linux candidate 作为正式 Golden，并确认当前法务草案。

12 张正式文件已写入 `artifacts/ui/golden/help/`、`artifacts/ui/golden/legal/` 与 `artifacts/ui/golden/export-publish/`。截图来自真实生产路由和固定验收数据；`help` 覆盖 FAQ 与空搜索状态，`legal` 覆盖三份法律文件入口和条款详情，`export-publish` 覆盖内容安全记录、证据、申诉/撤回入口及 AI 标识。Linux/Chromium 生成证据为 [Production CI #44045578715](https://github.com/ruifeng-y/novel-brain/actions/runs/44045578715) 的 `update_golden` Playwright artifact。最终正常 PR CI 必须再次通过四档 `toHaveScreenshot`、作者语言、`prototype_only` 扫描、无横向溢出和真实行为断言后才合并。

## 2026-11-19 dashboard 完整筛选与指标 Linux Golden 签收

签收人：ruifeng-y。作者确认 `artifacts/ui/candidates/m3-245-dashboard/` 中 dashboard 在 390 / 900 / 1180 / 1440 四档的 Linux/Chromium 候选作为正式 Golden。候选来自受控 `update_golden` 运行 [Production CI #44495408577](https://github.com/ruifeng-y/novel-brain/actions/runs/44495408577) 的 Playwright artifact。

- `dashboard-390.png`：`390x900`，SHA-256 `C8B7B0EFCD1E6FD0B11307ACD3DCFD95B85228CD7384C3BE2A088C2E5ABD4FAC`
- `dashboard-900.png`：`900x900`，SHA-256 `9BD05D2D5B4D91B8DAAE6D6014B03E8DE7456A8D00903F780AB0D011F8D797A7`
- `dashboard-1180.png`：`1180x900`，SHA-256 `629B2253D42BDF836DE48AE0EECE4303DF5650CE225030BC8518EB674C57850C`
- `dashboard-1440.png`：`1440x900`，SHA-256 `3CB0FDDA7BC3243B706D94CC6F8412500B3234ACF3B815149C0934EC79A1764D`

四张正式文件已写入 `artifacts/ui/golden/dashboard/`。最终正常 PR CI [44502900100](https://github.com/ruifeng-y/novel-brain/actions/runs/44502900100) 已通过四档 `toHaveScreenshot`、完整指标/筛选断言、作者语言、`prototype_only` 扫描和无横向溢出；Deployment Smoke [44502899883](https://github.com/ruifeng-y/novel-brain/actions/runs/44502899883) 同时通过。

## 2026-11-18 work-settings 与 dashboard Linux Golden 签收

签收人：ruifeng-y。作者确认 `#142` 的 `work-settings` 四档生产布局，以及受影响后的 `dashboard` 生产布局；并确认使用 Linux/Chromium actual 替换现有 Windows Golden。

本次替换文件为：

- `dashboard-390.png`：`390x900`，SHA-256 `46DA9319D2667BC7D0B485B50FB02E6F5F374E684C32E8FE8CA37D1A0636BDDB`
- `work-settings-390.png`：`390x2351`，SHA-256 `E12F17DB646D6483F1BD1B9366A2EF1E121FB503552D97F49273FEFEC8B28B11`
- `work-settings-900.png`：`900x1773`，SHA-256 `F8CAB6E6D14A5B9B942123FB4E4E1585B3BE4B7D4EA984058B227CCEF1FC2647`
- `work-settings-1180.png`：`1180x2634`，SHA-256 `709D751B4CE9218A35E5D0E38F8B1E5A84152D732A8CD146E73959CBFE60D77D`
- `work-settings-1440.png`：`1440x2936`，SHA-256 `11FB3866A545D1498D86369EF56DFE876734C974D299BC69B19245AF529958C5`

两张 390px Linux actual 在两次 Playwright 执行中的 SHA-256 完全一致，生成证据为 [Production CI #44124021122](https://github.com/ruifeng-y/novel-brain/actions/runs/44124021122)。此前失败在 390px 首次截图差异后停止后续比较，隐藏了其余 Windows 基线；`work-settings` 的 900 / 1180 / 1440 最终由 [Production CI #44138638764](https://github.com/ruifeng-y/novel-brain/actions/runs/44138638764) 的受控 `update_golden` 运行生成，并通过完整测试。该记录只证明视觉证据；当前 release status 以 parity matrix 为准，`work-settings` 在逐动作持久化审计和最终正常 PR CI 通过前保持 `production-built`。

## 2026-11-19 new-project 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-12 对 `new-project` 四档生产布局与正式 Golden 的视觉签收。本次 #223 不改变视觉基线，只补齐七个必需动作的真实 API 与持久化证据。

`apps/web/e2e/parity/new-project.spec.ts` 覆盖想法、空白、题材模板、设定导入、旧稿导入、导入冲突裁决和主创作线蓝图创建；断言包括持久化作品字段、导入设定实体、冲突选择、章节顺序、章节正文和 main 分支 head version node。targeted Playwright 13/13、作者语言、prototype-only 扫描及 390 / 900 / 1180 / 1440 四档无横向溢出均通过。

正常 PR Production CI [44514912820](https://github.com/ruifeng-y/novel-brain/actions/runs/44514912820) 的 `check` 与 `playwright`、Deployment Smoke [44514912829](https://github.com/ruifeng-y/novel-brain/actions/runs/44514912829) 均通过；`new-project` 提升为 `parity-verified`。

## 2026-11-19 work-overview 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-11 对 `work-overview` 正常态与长内容态四档正式 Golden 的视觉签收。本次 #224 不改变视觉基线，只补齐七个页面动作的真实 API 与持久化证据。

`apps/web/e2e/parity/work-overview.spec.ts` 覆盖继续写作、待处理任务、最近修改、跨卷文风趋势、卷末审计、卷末签收和创作线切换；断言包括 readiness 任务、持久化章节与设定、文风报告、审计报告的后续回读、作者签收决策及 branch-scoped 作品总览。targeted Playwright 4/4、完整 owner 语义测试、作者语言、prototype-only 扫描与四档 Linux Golden 回归均通过。

正常 PR Production CI [44532653293](https://github.com/ruifeng-y/novel-brain/actions/runs/44532653293) 的 `check` 与 `playwright`、Deployment Smoke [44532653451](https://github.com/ruifeng-y/novel-brain/actions/runs/44532653451) 均通过；`work-overview` 提升为 `parity-verified`。

## 2026-11-19 bible 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-11 与 2026-11-12 对 `bible` 四档正式 Golden 和题材化变化的视觉签收。本次 #225 不改变视觉基线，只补齐九个页面动作的真实 API 与持久化证据。

`apps/web/e2e/parity/bible.spec.ts` 覆盖九卡生成、卡片编辑、准备度检查、缺失卡片补全、结构化世界铁律、锁定、版本历史、锁定修改请求和解锁；断言包括故事圣经回读、结构规则查询、版本节点、幂等修改请求的持久化旧值/新值，以及解锁后的持久化状态。targeted Playwright 九动作测试、完整 owner 4/4、作者语言、prototype-only 扫描与四档 Linux Golden 回归均通过。

正常 PR Production CI [44554877251](https://github.com/ruifeng-y/novel-brain/actions/runs/44554877251) 的 `check` 与 `playwright`、Deployment Smoke [44554877179](https://github.com/ruifeng-y/novel-brain/actions/runs/44554877179) 均通过；`bible` 提升为 `parity-verified`。

## 2026-11-20 settings 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-11 与 2026-11-12 对 `settings` 四档正式 Golden 和题材化变化的视觉签收。本次 #226 不改变初始页面视觉基线，只补齐十个页面动作的真实 API 与持久化证据；人物关系编辑器仅在作者进入“关系”分区后展开。

`apps/web/e2e/parity/settings.spec.ts` 覆盖设定创建/编辑/删除、人物关系、地图、力量体系、时间线、自定义字段、提案裁决和题材包版本切换。断言包括实体与领域详情、时间线、自定义字段列表、提案状态、作品题材包版本，以及删除后的读取拒绝。targeted Playwright 动作场景、作者语言、prototype-only 扫描与四档 Linux Golden 回归均通过。

正常 PR Production CI [44573477468](https://github.com/ruifeng-y/novel-brain/actions/runs/44573477468) 的 `check` 与 `playwright`、Deployment Smoke [44573478266](https://github.com/ruifeng-y/novel-brain/actions/runs/44573478266) 均通过；`settings` 提升为 `parity-verified`。

## 2026-11-20 outline 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-11 与 2026-11-12 对 `outline` 四档正式 Golden 和题材化变化的视觉签收。本次 #227 不改变初始页面视觉基线，只补齐 11 个页面动作的真实 API 与持久化证据。

`apps/web/e2e/parity/outline.spec.ts` 覆盖节点创建/编辑、树状/看板/张力/账本视图、卷契约、场景卡、黄金三章选择、排序和锁定。断言包括节点摘要、章节张力、账本记录、卷目标、场景 POV、黄金三章选定候选和锁定/排序状态的持久化回读。完整 `pnpm check` 通过（120 files / 605 tests），作者语言、prototype-only 扫描与四档 Linux Golden 回归均通过。

正常 PR Production CI [44676510957](https://github.com/ruifeng-y/novel-brain/actions/runs/44676510957) 的 `check` 与 `playwright`、Deployment Smoke [44676510790](https://github.com/ruifeng-y/novel-brain/actions/runs/44676510790) 均通过；`outline` 提升为 `parity-verified`。

## 2026-11-20 foreshadows 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-10 至 2026-11-11 对 `foreshadows` 四档正式 Golden 和 loading 状态的视觉签收。本次 #228 不改变页面视觉基线，只补齐九个页面动作的真实 API 与持久化证据。

`apps/web/e2e/parity/foreshadows.spec.ts` 覆盖创建、编辑、埋设、推进、回收、失败回收、放弃、延期和重新检查。断言包括条目摘要、状态转换、目标窗口、回收证据，以及检查结果与持久化逾期记录 ID 的绑定。targeted Playwright 九动作、错误重试状态、四档结构、作者语言和 prototype-only 扫描均通过；15 秒全量 Vitest 通过（120 files / 605 tests）。

正常 PR Production CI [44694419586](https://github.com/ruifeng-y/novel-brain/actions/runs/44694419586) 的 `check` 与 `playwright`、Deployment Smoke [44694419654](https://github.com/ruifeng-y/novel-brain/actions/runs/44694419654) 均通过；`foreshadows` 提升为 `parity-verified`。

## 2026-11-20 writing 新章节与版本恢复视觉签收

签收人：ruifeng-y。#229 在写作台补齐“新建章节”和旧版恢复控件，因此重新生成 `writing` 四档 Linux/Chromium 候选。作者已确认 `artifacts/ui/candidates/m3-229-writing/` 中的 390 / 900 / 1180 / 1440 四张候选，并同意将其作为当前正式 Golden。

候选由受控 Production CI [44704229643](https://github.com/ruifeng-y/novel-brain/actions/runs/44704229643) 的 `update_golden` 任务生成；390 与 900 正式文件本次更新，1180 与 1440 候选与现有正式文件一致。

`apps/web/e2e/parity/writing.spec.ts` 覆盖生成、新章节、续写、整章改写、扩写、缩写、改视角、补钩子、标题、摘要、选区改写、检查、事实确认/驳回、章节批准、事实提交、旧版恢复和版本保存。正常 PR Production CI [44710611123](https://github.com/ruifeng-y/novel-brain/actions/runs/44710611123) 的 `check` 与 `playwright`、Deployment Smoke [44710611232](https://github.com/ruifeng-y/novel-brain/actions/runs/44710611232) 均通过；`writing` 提升为 `parity-verified`。

## 2026-11-20 export-publish 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-17 对 `export-publish` 四档 Linux/Chromium Golden 的视觉签收。本次 #232 不改变页面布局，只补齐七个必需动作的真实 API 与持久化证据。

`apps/web/e2e/parity/export-publish.spec.ts` 覆盖导出 receipt/manifest、真实文件下载与文件名/响应头/内容哈希校验、固定发布预览、读者预览、发布文案复制、worker 过期清理、内容安全申诉与重新导出。过期动作显式调用生产维护周期使用的同一 cleanup processor，并回读对象键和来源描述已清空、下载返回 `410`、历史记录仍保留。targeted Playwright 2/2、作者语言、prototype-only 扫描和四档结构断言均通过。

正常 PR Production CI [44763155194](https://github.com/ruifeng-y/novel-brain/actions/runs/44763155194) 的 `check` 与 `playwright`、Deployment Smoke [44763153754](https://github.com/ruifeng-y/novel-brain/actions/runs/44763153754) 均通过，现有四档 Golden 无需更新；`export-publish` 提升为 `parity-verified`。

## 2026-11-20 work-settings 逐动作持久化与最终 CI 签收

沿用作者在 2026-11-18 对 `work-settings` 四档 Linux/Chromium Golden 的视觉签收。本次 #233 不改变页面布局，只补齐九个必需动作的真实 API 与持久化证据。

`apps/web/e2e/parity/work-settings.spec.ts` 覆盖设置、标签、状态和封面的真实写入与回读，复制默认隔离章节正文，归档恢复精确回到原状态和主分支，回收站保留期与永久删除后的分支、章节、版本和导出收据清理均有断言。targeted Playwright 7/7、完整单元 606 项、作品集成测试 14 项、作者语言、prototype-only 扫描和四档结构断言均通过。

正常 PR Production CI [44773690891](https://github.com/ruifeng-y/novel-brain/actions/runs/44773690891) 的 `check` 与 `playwright`、Deployment Smoke [44773691156](https://github.com/ruifeng-y/novel-brain/actions/runs/44773691156) 均通过，现有四档 Golden 无需更新；`work-settings` 提升为 `parity-verified`。

## 变更规则

原型页面结构、关键动作或门禁发生变化时，先更新原型、页面/动作矩阵、`docs/ui/v1-ui-parity-matrix.md` 和截图，再发起新的签收。生产 UI 不得自行偏离本基线。
