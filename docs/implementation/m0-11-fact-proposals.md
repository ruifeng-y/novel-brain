# M0-11 事实提案与逐条确认

> Issue: #77
> Capability IDs: GEN-003, QUALITY-003
> UI parity matrix: writing

## 实现范围

- 从章节当前正文版本抽取带主体、关系、事实、来源句、置信度、风险和必填标记的类型化事实提案。
- 事实提案状态覆盖 `proposed`、`confirmed`、`modified_confirmed`、`rejected`、`superseded`。
- 单章生成 Job 继续执行 `extract_facts → await_review`，完成后进入 `waiting_review`，不自动批准章节或提交故事事实。
- 每次人工决策写入独立记录，包含操作者、操作者显示名、时间、原因、决策前快照和决策后快照。
- 正文版本更新后重新抽取时，旧版仍待确认的事实自动标记为 `superseded`，并记录替代原因；已决策事实保留。
- 确认和修改确认只改变事实提案，不写入 `entities` 或已确认设定投影。
- 事实提案不会进入上下文编译器；后续章节上下文仍只使用已提交故事事实和已确认设定，驳回提案不会成为来源。
- 写作台展示待确认和已决策事实、风险、来源章、来源句、决策人和决策原因，并提供确认、修改后确认和驳回动作。

## 验证结果

- `pnpm check`：通过。
- `pnpm test:integration`：9 个集成测试文件、51 项测试通过。
- `pnpm test:e2e apps/web/e2e/parity/writing.spec.ts`：5 项 Playwright 测试通过，覆盖 390/900/1180/1440 视口。
- Playwright 生成章节后确认两条事实，并比较确认前后已确认设定响应完全一致。
- HTTP 集成覆盖来源句与风险、操作者/时间/原因、修改确认、驳回、替代、跨租户拒绝和上下文排除。

## 边界

- 章节批准、故事事实提交、Canon commit 和已确认设定更新由 #78 实现。
- 真实 DeepSeek 事实抽取 smoke、M0 全链路安全与 UI 最终签收由 #79 完成。
- 生产 golden 截图仍按 ADR 0027 在写作页生产基线被作者确认后生成。
