# M2-04/05/06 修改、平行版本、搜索与分块导入

> Primary issues：#120、#123、#126、#127、#128
> Supporting issues：#94、#95、#96、#121、#122、#124、#125
> Capabilities：CHANGE-001–CHANGE-009、IO-001–IO-003、SEARCH-001、SEARCH-002
> Date：2026-11-12
> Branch：`codex/m2-97-final`

## 1. 修改请求与影响分析

- 新增通用 `change_requests` 与 `change_impacts`，承载修改目标、目标版本、原因、前后值、风险、状态和影响证据。
- API：
  - `GET /api/v1/works/:workId/branches/:branchId/changes`
  - `POST /api/v1/works/:workId/branches/:branchId/changes`
  - `POST /api/v1/works/:workId/branches/:branchId/changes/:changeId/analyze`
  - `POST /api/v1/works/:workId/branches/:branchId/changes/:changeId/apply`
- 应用修改在分支行锁内校验版本，创建 `change_apply` 版本节点并推进分支 head；高风险修改必须二次确认。
- 应用请求同时校验修改状态、影响分析存在性和目标对象版本；实体、章节、大纲、账本和作品会写回当前分支对象，重复应用返回同一节点。
- 事实类修改和事实摘取不能通过通用应用接口直接改写 `facts`；接口返回 `FACT_DECISION_REQUIRED`，必须走事实决策与故事事实提交状态机。
- `POST /api/v1/works/:workId/branches/:branchId/rollback` 校验当前 head，恢复目标版本快照并追加 `rollback` 节点，不删除原应用或撤销历史。
- 修改中心页面 `/workspace/[workId]/changes` 使用真实 API 展示修改记录、影响分析、应用动作和高风险确认。

## 2. 平行版本与选择性摘取

- 从任意版本节点创建平行版本，分支 head 指向来源节点，允许共享同一历史节点。
- `GET /compare/:sourceBranchId` 按统一版本图逐对象比较，生成章节、设定、事实、大纲和账本 `merge_items`。
- 比较项带 `added`、`removed`、`changed`、`unchanged` 类型和稳定逻辑对象键；同一对象跨分支不同 ID 也能识别为冲突。
- 每个对象单独接受或拒绝，记录 `merge_decisions`、原因和审计。
- 应用摘取只处理已接受项，必须提交目标分支当前 head；head 变化后旧预览返回 `VERSION_CONFLICT`。成功时写回目标对象、创建 `branch_merge` 版本节点，并按是否覆盖目标对象写 `merge_completed` 或 `merge_conflict` 站内通知。
- `POST /rollback` 也支持以 `branch_merge` 节点为目标，恢复摘取前的目标对象快照并追加新的 `rollback` 节点。
- V1 不执行整分支自动合并，也不覆盖历史版本。

## 3. 中文搜索

- `search_documents` 作为派生索引，新增 `pg_trgm` 表达式索引。
- `POST /works/:workId/branches/:branchId/search/rebuild` 从设定、事实、地图节点、时间线和当前章节正文重建当前分支索引。
- 重建运行写入 `search_rebuild_runs`，按 200 条批次逐事务提交；`GET /search/rebuilds/:runId` 查询进度，`POST /search/rebuilds/:runId/process` 可从中断点继续。
- `search_rebuild_runs` 启用并强制租户 RLS；重建不再先删除旧索引，读查询按最新来源版本过滤，完成后再清理过期派生行。
- `GET /works/:workId/branches/:branchId/search?q=...` 返回来源类型、标题、摘要、版本节点和分数。
- AppShell 顶栏搜索支持当前作品分支上下文和全部作品主线两种范围；结果包含 `workId` 并跳转到对应作品页面。

## 4. 分块导入

- `import_jobs` 新增 chunk/checkpoint/metadata 字段，`import_chunks` 保存分块状态。
- 分块导入不把全文复制进 `import_jobs.source_text`；每块保存顺序和 `start_offset`/`end_offset`，创建请求以 `Idempotency-Key` 幂等。
- 大文件客户端先调用 `chunked/start`，再逐个追加分块，避免一次请求在内存中序列化全部正文。
- API：
  - `POST /api/v1/imports/manuscripts/chunked`
  - `POST /api/v1/imports/manuscripts/:importId/process`
  - `GET /api/v1/imports/manuscripts/:importId/progress`
  - `POST /api/v1/imports/manuscripts/:importId/pause`
  - `POST /api/v1/imports/manuscripts/:importId/resume`
  - `POST /api/v1/imports/manuscripts/:importId/cancel`
- 每次处理一个分块并更新检查点；暂停、恢复、取消和重复处理都是幂等的，全部分块完成后才允许确认创建作品。
- 分块创建和修改请求创建均使用事务级 advisory lock，保证并发相同 `Idempotency-Key` 返回同一结果而不是唯一键 500。
- 分块确认按来源块逐块比较编辑后的章节，不再把全部块拼成单一 `sourceText` 后再校验。
- 导入默认保留原文，不自动生成语义候选。

## 5. 验证

- `apps/api/test/m2-04-06.integration.test.ts`：覆盖分支上下文、真实目标写回、回滚、跨分支冲突、可恢复搜索重建、分块幂等/暂停恢复和跨租户拒绝。
- `apps/web/e2e/parity/changes.spec.ts`：覆盖 changes 四档视口、加载/错误/冲突/部分失败/旧版本拒绝、shell 中文搜索和逐对象冲突。
- `apps/web/e2e/parity/work-overview.spec.ts`：覆盖选中平行版本跨作品页面生效并在切换后清除旧分支内容。
- `pnpm test`、`pnpm test:integration`、typecheck、lint、format、migrations、OpenAPI 和 guardrails 需在最终合并前重跑。

## 6. 视觉与边界

- changes 四档当前生产基线已生成：`artifacts/ui/golden/changes/changes-{390,900,1180,1440}.png`。
- changes 页面仍等待作者对本次新增页面的正式视觉签收；签收前状态保持 `production-built`。
- 搜索索引是派生数据，可从 PostgreSQL 源表重建；不引入向量检索。
