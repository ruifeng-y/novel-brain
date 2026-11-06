# M1-06a 写作动作扩展与局部重写

> Ticket: #116. Primary capability: GEN-002.

## 1. 交付范围

- `@novel-brain/contracts`：九种独立 discriminated input（续写、改写、扩写、缩写、改视角、补钩子、标题、摘要、选区重写），统一版本产物、动作 job 和 Worker envelope。
- `@novel-brain/core`：动作权限/角色/提示词元数据、选区精确替换与范围计算。
- `@novel-brain/db`：扩展 `jobs` 为 `write_action`，新增 `writing_actions` 产物表，并接入现有 `version_nodes`、`job_steps`、`job_checkpoints`、`prompt_versions`、`model_calls`、`cost_reservations`。
- `apps/api`：新增章节写作动作创建、列表、查询、取消、重试和事件流路由。
- `apps/worker`：新增 `WritingActionProcessor`，复用假 Provider、预算、轨迹、幂等和恢复协议。
- `apps/web`：写作页提供续写、改写选中、扩写、缩写、改视角、补钩子、标题和摘要的真实动作、状态、范围与产物展示。

## 2. 不变量

- 每个动作绑定不可变 `sourceVersionId`；章节正文只追加新版本，不原地覆盖。
- `selection_rewrite` 只替换指定字符区间，未选前缀/后缀按原字节保留，并记录 original/new range。
- 标题和摘要写入动作产物节点，不创建正文版本。
- 同一幂等键返回原动作 job；同一 job 只写一份产物。
- 失败、取消、重试保留源版本、已完成步骤和 checkpoint；失败恢复从首个未成功步骤继续。
- 普通日志和轨迹 API 不返回正文、prompt 或 Key。

## 3. API

- `POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/write-actions`
- `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/write-actions`
- `GET /api/v1/works/:workId/branches/:branchId/write-actions/:actionJobId`
- `POST /api/v1/works/:workId/branches/:branchId/write-actions/:actionJobId/cancel`
- `POST /api/v1/works/:workId/branches/:branchId/write-actions/:actionJobId/retry`
- `GET /api/v1/works/:workId/branches/:branchId/write-actions/:actionJobId/events`

## 4. 迁移

- `packages/db/migrations/0035_writing_actions.sql`
- `writing_actions` 启用 `FORCE ROW LEVEL SECURITY`，按 `user_id` 隔离。
- `version_nodes.node_type` 增加 `writing_action_output`；动作 job 仍使用同一张任务表与同一张版本图。

## 5. 证据

- 契约：`packages/contracts/test/writing-actions.test.ts`
- 纯规则：`packages/core/test/writing-actions.test.ts`
- API + Worker：`apps/api/test/writing-actions.integration.test.ts`
  - 九种动作全部走 deterministic fake provider
  - 选区重写保留前缀/后缀并返回精确范围
  - 源版本保留、幂等、成本、轨迹、跨租户拒绝
  - 取消、Provider 失败、checkpoint 重试
- UI：`apps/web/e2e/parity/writing.spec.ts`
  - 选区重写、原稿保留、标题应用
  - 390 / 900 / 1180 / 1440 四档无横向溢出
  - 作者语言扫描

## 6. 命令

```bash
pnpm build:packages
pnpm vitest run packages/contracts/test/writing-actions.test.ts packages/core/test/writing-actions.test.ts
pnpm vitest run --config vitest.integration.config.mts apps/api/test/writing-actions.integration.test.ts
pnpm --filter @novel-brain/api openapi:generate
pnpm --filter @novel-brain/web typecheck
pnpm exec playwright test apps/web/e2e/parity/writing.spec.ts -g "rewrites only the selected draft"
```
