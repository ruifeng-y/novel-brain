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

## 2026-11-06 M1 黄金三章生产变更

Issue #147 在 outline 页加入黄金三章候选比较、六维评分与证据、作者选择、失败阻断、例外锁定和风格基线。`apps/web/e2e/parity/golden-three.spec.ts` 已覆盖四档视口与真实 API 动作；现有 outline 生产 golden 已不代表新布局，需在 M1 布局稳定后重新拍摄并完成作者视觉签收。

## 变更规则

原型页面结构、关键动作或门禁发生变化时，先更新原型、页面/动作矩阵、`docs/ui/v1-ui-parity-matrix.md` 和截图，再发起新的签收。生产 UI 不得自行偏离本基线。
