---
Status: accepted
---

# M0 协议、状态边界和 UI 对齐门禁在编码前冻结

## Context

当前需求、技术设计、原型和 M0 spec 已经明确“要做什么”，但如果直接开始编码，API 字段、错误码、Cookie/CSRF、Job 契约、事实提交门禁和 UI 验收方式仍可能在实现中各自解释。原型已经签收，但生产 UI 还不存在，必须把原型签收转成可执行的合并与发布门禁。

## Decision

- M0 的跨端协议由 `packages/contracts` 中的 Zod schema 定义，并生成 OpenAPI 类型；Web 与 API 不得各写一套 DTO。
- M0 只使用 `/api/v1`。请求/响应、错误、分页、幂等、并发、SSE 和认证约定由 `docs/technical/m0-protocol-freeze.md` 冻结。
- Worker 只接受带 `jobType`、`workId`、`branchId`、`idempotencyKey` 和检查点的 typed job contract；API 不直接执行长任务。
- 章节批准、事实确认和故事事实提交是三个独立 API 动作。事实提交必须同时满足章节已批准/锁定、必填事实已确认、无未解决高风险冲突。
- AI 测试使用确定性 fake provider；真实 DeepSeek 只用于独立 smoke 和评测，不进入普通单元测试。
- 原型是 UI 验收基线。`docs/ui/v1-ui-parity-matrix.md` 是逐页生产台账；M0 生产页面必须通过页面/动作/状态矩阵、四档响应式、固定数据截图对比和作者语言扫描，未通过不得合并。
- 任何协议、状态机或 UI 基线变更必须先更新协议文档/原型并重新签收，不能在实现 PR 中静默改变。

## Consequences

- M0 开工前不再需要新的产品 ADR；后续缺的是实现契约和验收证据，不是继续讨论方向。
- 前端、后端和 Worker 共享同一套类型和错误码，减少联调返工。
- 事实三段状态机不会在 UI 或 API 层被合并。
- UI 一致性从“口头要求”变成 CI 和发布门禁。
