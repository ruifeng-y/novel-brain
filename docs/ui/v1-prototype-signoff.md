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

Golden 文件位于 `artifacts/ui/golden/<page>/<page>-<viewport>.png`。作者本次对 8 个页面的视觉方向作出签收；其中 #172 为 `entity-detail` 与 `foreshadows` 新生成并提交了 8 张正式 Linux/CI Golden，#176 为 `work-overview` 新生成并提交了正常态与长内容态共 8 张正式 Linux/CI Golden。其余 20 张同名页面文件属于早期基线，不作为当前 M1 的正式比较证据，需在 #174 中重新生成。生成证据为 [Production CI #42670999022](https://github.com/ruifeng-y/novel-brain/actions/runs/42670999022)，正常 Playwright 截图比较见 [Production CI #42682407291](https://github.com/ruifeng-y/novel-brain/actions/runs/42682407291)。

本次视觉判断没有未批准项，也没有新增产品偏差。它取代前文 2026-11-05 至 2026-11-07 对 M1 页面视觉方向的待签收状态，但不替代其余页面尚未生成的正式 Golden 证据。

#172 当前只有 `entity-detail` 与 `foreshadows` 具备真实生产路由的四档 `toHaveScreenshot` 断言，但 `entity-detail` 仍缺 `prototype_only` 泄漏扫描证据，`foreshadows` 仍缺 `loading` 状态断言；#176 补齐 `work-overview` 正常态和长内容态的自动 Golden 比较，其余 5 页仍使用 attach 截图或未参与比较的历史 Golden 文件。完整 page checklist、其余 20 张正式 Golden 和状态证据由 #174 跟踪。完成前，8 个页面都不得标记为 `parity-verified`，#161 的完整自动化视觉回归条件也尚未满足。

## 2026-11-10 Work Overview 分支与长内容证据

签收人：ruifeng-y。#176 补齐 `work-overview` 的当前作品/主线壳层上下文、待处理与最近修改列表，以及真实长作品名、长摘要、长章节和长设定证据。正常态与长内容态均在 390 / 900 / 1180 / 1440 四档视口下执行 `toHaveScreenshot`，并覆盖作者语言、prototype_only 扫描和无横向溢出断言。作者确认 8 张 Linux/CI Golden 作为当前视觉基线，生成证据为 [Production CI #42810925879](https://github.com/ruifeng-y/novel-brain/actions/runs/42810925879)。本次证据只覆盖 `work-overview` 生产路由；全站当前作品与平行版本切换一致性仍由 #95、#123 跟踪，不声称 WORK-009 全站完成。本记录补齐 #174 中 `work-overview` 的状态缺口，不把整页提升为 `parity-verified`。

## 2026-11-10 Account Settings Key 错误态证据

#177 补齐 `account-settings` 的 Key 无效、失效、连接测试失败、掩码保持、失败后替换 Key 与重试恢复证据。正常态生产 Golden 不变；错误态在 390 / 900 / 1180 / 1440 四档视口下执行 `toHaveScreenshot`，并覆盖作者语言、prototype_only 扫描和无横向溢出断言。状态 Golden 的 Linux/CI 生成证据为 [Production CI #42780689501](https://github.com/ruifeng-y/novel-brain/actions/runs/42780689501)。账号导出、注销恢复期与永久删除仍由 #134 独立跟踪，本记录不提升整页状态。

## 变更规则

原型页面结构、关键动作或门禁发生变化时，先更新原型、页面/动作矩阵、`docs/ui/v1-ui-parity-matrix.md` 和截图，再发起新的签收。生产 UI 不得自行偏离本基线。
