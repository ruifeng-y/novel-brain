# M0-07 故事圣经九卡生成、编辑与锁定

> Issue: #73
> Capability IDs: ONBOARD-001, ONBOARD-002, ONBOARD-004, ONBOARD-005
> UI parity matrix: bible

## 实现范围

- 故事圣经固定为签收的九张仙侠卡片：一句话故事、核心卖点、主角、金手指、世界铁律、主线、支线、结局方向、读者承诺。
- 生成入口基于作品想法返回 `proposed` 提案，不会自动锁定，也不会提前创建故事圣经版本。
- 作者可以编辑未锁定卡片；每次写入使用 `version` 乐观并发控制，并返回完成数、缺失卡片和是否可锁定。
- 锁定要求九卡完整，创建 `story_bible_version` 版本节点和专用 `story_bible_versions` 快照，记录操作者、时间、父节点并推进分支头。
- 锁定后的直接编辑、重新生成和卡片删除返回 `BIBLE_LOCKED`；未锁定时卡片删除仍被九卡不变式拒绝。
- M0 故事圣经只对仙侠作品开放生成、编辑和锁定；历史/都市作品保留空九卡视图并显示明确禁用原因。
- `/workspace/[workId]/bible` 使用真实 HTTP API，覆盖 loading、empty、error、locked、proposal、partial 和 long-content 状态。
- 作品总览的故事圣经准备度在锁定后更新为已就绪。

## 数据与契约

- 新增 `story_bibles` 与 `story_bible_versions` 专用表，均启用并强制 RLS。
- `story_bibles` 约束九卡数组、状态和锁定元数据；锁定版本通过 `version_node_id` 引用单一版本图。
- `version_nodes.node_type` 增加 `story_bible_version`。
- 共享 Zod 契约覆盖九卡键/标题、卡片、准备度、提案、更新请求、锁定请求和响应。
- OpenAPI 从 NestJS 控制器与共享 Zod schema 生成，并同步派生 TypeScript 类型。

## 验证接缝

- API：通过 `/api/v1/works/:workId/branches/:branchId/story-bible` 的公开 HTTP 路由，使用真实 PostgreSQL/Redis 集成测试验证。
- Web：通过 `/workspace/[workId]/bible` 的真实浏览器流程验证生成、编辑、准备度、锁定和只读门禁。
- 数据：HTTP 响应与数据库查询共同验证九卡、版本节点父指针、操作者、时间和分支头。

## 验证结果

- `pnpm check`：通过，29 个单元/契约测试。
- `pnpm test:integration`：通过，32 个真实 PostgreSQL/Redis HTTP 集成测试。
- `pnpm exec playwright test apps/web/e2e/parity/bible.spec.ts apps/web/e2e/parity/work-overview.spec.ts`：通过，6 个 Playwright 测试。
- HTTP 集成覆盖空九卡、生成提案、部分编辑、准备度、版本冲突、未就绪锁定、版本图锁定、锁定编辑/删除拒绝、非法卡片、跨租户隔离和非仙侠范围。
- Playwright 覆盖生成、逐卡编辑、`9/9` 准备度、锁定、锁定后 API 拒绝，以及 loading/error/partial/long 和 390/900/1180/1440 四档视口。
- 审查修复轮已收敛重复仓储事务和前端 mutation 请求，并补版本节点父指针断言。

## 边界

- M0 不提供解锁或锁定内容修改请求；后续修改走 #84/#87 的提案、影响分析和版本能力。
- 历史、都市故事圣经模板由后续题材包能力开放，本 ticket 不伪造非仙侠模板。
- 生产 golden 截图和作者视觉签收按 ADR 0027 由 #79 完成。
