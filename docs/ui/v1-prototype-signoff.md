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

## 变更规则

原型页面结构、关键动作或门禁发生变化时，先更新原型、页面/动作矩阵、`docs/ui/v1-ui-parity-matrix.md` 和截图，再发起新的签收。生产 UI 不得自行偏离本基线。
