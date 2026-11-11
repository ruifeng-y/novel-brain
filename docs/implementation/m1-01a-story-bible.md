# M1-01a 九卡故事圣经、提案版本与锁定

> Issue: #143
> Capability IDs: ONBOARD-001, ONBOARD-002, ONBOARD-004
> UI parity matrix: bible

## 实现范围

- 保留签收的九卡结构，并为世界铁律卡片增加结构化规则：规则名称、自然语言约束、适用范围和例外。
- 生成提案、逐卡编辑、锁定和解锁都会在单一版本图中追加 `story_bible_version` 节点与不可变快照；编辑和解锁必须填写原因。
- 锁定门禁返回缺失卡片、缺失世界铁律和同名规则冲突；存在结构冲突时不能锁定。
- 世界铁律按版本写入 `story_bible_world_rules`，可通过故事圣经 API 查询，并作为独立必选来源进入生成上下文。
- 版本历史与世界铁律列表使用 `cursor`/`limit` 游标分页；修改请求支持 `Idempotency-Key`，重复提交返回同一请求。
- 锁定后直接编辑和删除继续返回 `BIBLE_LOCKED`；作者可以创建记录旧值、新值、标题、原因和中等风险的修改请求，也可以显式解锁并留下审计记录。
- 故事圣经页面增加结构化世界铁律编辑、修改原因、版本历史、冲突提示、锁定修改请求和解锁入口。

## 数据与契约

- `story_bible_versions` 增加 `action` 与 `reason`，并约束为 `proposed`、`edited`、`locked`、`unlocked`。
- 新增 `story_bible_world_rules`，按故事圣经版本保存结构化规则，启用并强制 RLS。
- 新增 `story_bible_change_requests`，保存锁定内容修改请求，启用并强制 RLS。
- 共享 Zod/OpenAPI 契约新增世界铁律、准备度问题、版本历史、解锁请求、修改请求及对应 API 响应。
- 生成 Worker 与 API 都从 `story_bible_world_rules` 读取当前锁定版本的规则；`compileChapterContext` 将其作为 `story-bible:world-rules` 必选来源，并保留故事圣经来源引用。

## 验证接缝

- API：通过 `/api/v1/works/:workId/branches/:branchId/story-bible` 的公开 HTTP 路由，使用真实 PostgreSQL/Redis 集成测试验证。
- Web：通过 `/workspace/[workId]/bible` 的真实浏览器流程验证提案、编辑、冲突、锁定、修改请求、解锁和长内容状态。
- 数据：HTTP 响应与数据库查询共同验证版本节点父指针、分支头、操作者、原因、世界铁律和修改请求。

## 验证结果

- `pnpm check`：通过，52 项单元/契约测试，格式化、lint、typecheck 全部通过。
- `pnpm test:integration`：通过，63 项真实 PostgreSQL/Redis HTTP 集成测试。
- `pnpm exec playwright test apps/web/e2e/parity/bible.spec.ts`：通过，3 项浏览器测试，覆盖 proposal/edit/conflict/locked/long 与 390/900/1180/1440 四档视口。
- 全量 Playwright：58/59 通过；唯一失败为既有 `auth-390` 截图基线在当前 Windows Chromium 环境的 0.04 像素差异，与本 ticket 页面和改动无关。
- `pnpm --filter @novel-brain/api openapi:generate`：通过，OpenAPI 与派生类型已同步；`openapi:check` 在提交前会因工作区存在预期 diff 而退出。
- 新增 `versions`、`world-rules`、`unlock`、`change-requests` 的跨用户 `403` 断言；修改请求幂等与版本游标分页均有集成测试。

## 边界

- 修改请求当前只记录入口与待分析状态；影响分析、应用、撤销和版本图事务由 M2 #120–#122 承担。
- 世界铁律使用确定性结构校验和同名冲突检查，不在本 ticket 中实现完整语义证明。
- 本 ticket 不改变章节批准、事实确认和故事事实提交三段状态机。
- 故事圣经新增 M1 交互后，生产 golden 需要按 ADR 0027 重新生成并由作者签收；当前 parity matrix 状态为 `production-built`，签收记录已标注待重新签收。
