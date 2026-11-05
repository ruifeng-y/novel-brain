# M0-12 章节批准、事实提交与设定更新

> Issue: #78
> Capability IDs: GEN-006, QUALITY-003
> UI parity matrix: writing

## 实现范围

- 章节批准是独立审核动作，只把 `waiting_review` 章节推进到 `approved`，并写入不可变审核决策和审计记录；事实提案与已确认设定不变。
- 生成任务完成后，章节与 Job 同时进入等待审核状态，批准接口不会接受计划中、写作中或已驳回章节。
- 故事事实提交单独使用 `POST /chapters/:chapterId/canon/commit`，必须携带正文版本和幂等键。
- 未批准章节返回 `CANON_CHAPTER_NOT_APPROVED`；必填事实未确认或仍有未解决高风险事实时返回 `FACT_SUBMISSION_BLOCKED`。
- 提交成功在同一事务内创建 `canon_commit` 版本节点、Canon 提交记录、来源事实和派生章节摘要，并把分支头推进到新节点。
- 提交记录保存来源章节、正文版本、全部已决策事实快照、操作者和提交时间；重试返回已有提交，不重复创建节点或事实。
- 已确认设定投影只读取已提交事实；事实确认或章节批准不会提前更新投影。
- 后续章节的上下文编译会读取已提交事实，驳回和未提交提案不会进入上下文。
- 写作台展示独立的“批准本章”和“提交本章事实”门禁，提交后显示摘要已更新；设定中心把提交事实显示为章节事实。
- 新表 `review_decisions`、`canon_commits`、`facts` 启用 RLS，审核、提交和提交记录读取均有跨租户拒绝测试。

## 共享契约与数据

- 新增章节审核、Canon 提交、Canon 决策/事实/摘要和提交事实投影的 Zod 契约，并生成 OpenAPI 与 TypeScript 类型。
- 章节批准、事实决策和故事事实提交保持三个独立 API 与状态转换。
- 单一版本图新增 `canon_commit` 节点，节点 `snapshot_id` 指向对应提交记录。

## 验证结果

- `pnpm check`：通过，36 项单元与契约测试。
- `pnpm test:integration`：9 个集成测试文件、55 项测试通过。
- `pnpm test:e2e apps/web/e2e/parity/writing.spec.ts`：6 项 Playwright 测试通过。
- HTTP 集成覆盖批准不改事实/设定、两种提交门禁、成功提交、来源与决策快照、版本图、摘要、幂等重试、后续上下文和跨租户拒绝。
- Playwright 覆盖批准前禁用、批准后仍待确认、必填事实确认后提交成功、提交前设定不变和提交后设定更新。

## 边界

- 真实 DeepSeek 事实抽取 smoke、M0 全链路安全与 UI 最终签收由 #79 完成。
- 生产 golden 截图仍按 ADR 0027 在写作页生产基线被作者确认后生成。
- 故事事实的后续修改、回滚和选择性摘取由 M2 修改与版本能力继续实现。
