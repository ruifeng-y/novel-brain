# M0-10 单章生成 Job、上下文与轨迹

> Issue: #76
> Capability IDs: GEN-001, AGENT-004, AGENT-005, AGENT-010, AGENT-011
> UI parity matrix: writing

## 实现范围

- 单章生成创建持久化 `generate_chapter` Job，包含幂等键、费用/token/修订轮次预算和初始检查点。
- API 先写 PostgreSQL，再投递 BullMQ；Worker 从 PostgreSQL 读取任务和检查点，不依赖队列消息作为真源。
- Worker 执行 `prepare → compile_context → draft → verify → revise`，步骤成功、失败、费用和检查点均落库。
- 上下文编译器保留必用事实，按预算选择或淘汰可选来源，并记录 compiler version、selected、evicted、source refs 和 token 使用量。
- 上下文包按 Job 版本化保存；失败重试读取已保存快照，不使用重试时可能已变化的设定重新编译。
- 草稿和修订稿分别写入单一版本图的 `chapter_version` 节点，并更新写作台当前版本。
- Job 事件通过 SSE 回放和推送，覆盖创建、步骤进度、完成、失败和取消。
- 失败保留草稿、检查点和稳定错误码；重试从失败步骤继续，已成功步骤不会重写。
- 确定性 Fake Provider 支持按步骤注入失败，普通测试不访问网络。
- 写作台展示生成进度、当前步骤、断点、费用、来源引用、淘汰来源和失败重试，并保持作者语言。

## 验证结果

- `pnpm check`：通过。
- `pnpm test:integration`：真实 PostgreSQL/Redis HTTP 与 Worker 集成测试通过。
- `pnpm test:e2e apps/web/e2e/parity/writing.spec.ts`：写作台成功、失败、断点恢复及 390/900/1180/1440 四档视口通过。
- HTTP/Worker 集成覆盖幂等排队、跨租户拒绝、取消事件、上下文版本、草稿版本、Provider 失败、预算耗尽和从 `revise` 重试。

## 边界

- 本章事实提案由 #77 继续实现；本 ticket 的 Job 在修订稿保存后完成。
- 真实 DeepSeek 生成 smoke、M0 全链路安全与 UI 签收由 #79 完成。
- 生产 golden 截图按 ADR 0027 在写作页生产基线被作者确认后生成。
