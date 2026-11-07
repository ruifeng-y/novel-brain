# M2-01a 批量任务层级、卷章工作项与 DAG 计划器

> Issue：#151
> Capability：GEN-007
> 分支：`codex/m1-full-loop`
> 日期：2026-11-07

## 1. 实现范围

- 新增 `job_work_items`：book / volume / chapter / step 四层工作项，包含稳定 key、父工作项、章节/大纲引用、输入版本、依赖、状态、尝试次数、幂等键、检查点和输出引用。
- 扩展 `jobs`：`parent_job_id`、`job_type`、`work_item_key`，新增 `batch_plan` 任务类型和批量计划幂等唯一索引。
- 新增共享契约：批量范围、审批方式、优先级、工作项、计划摘要、计划元数据和 DAG 校验问题。
- 新增纯计划器：按章、按卷、连续区间、全本四种范围生成确定性四层 DAG；稳定 key 使用 `book` / `volume:<nodeId>` / `chapter:<chapterId>` / `step:<chapterId>:<stepKey>`。
- 新增 DAG 校验：重复 key、缺失依赖、环、跨作品引用、缺失父项和非法父子类型。
- 新增调度策略：`global=4`、`perWork=2`、`perUser=2`，交互式优先于批量；请求并发会被策略上限裁剪。
- 新增 API：
  - `POST /works/:workId/branches/:branchId/batch-plans`
  - `GET /works/:workId/branches/:branchId/batch-plans/:planId`
  - `GET /works/:workId/branches/:branchId/batch-plans/:planId/items`
- 计划创建只写一条父任务和 `job_work_items`，不把数千章展开成数千个 BullMQ job。

## 2. 关键约束

- 计划 ID 由 `userId + workId + branchId + Idempotency-Key` 确定性派生；重复请求返回同一计划和同一批工作项。
- 同一 Idempotency-Key 提交不同请求体返回 `BATCH_PLAN_IDEMPOTENCY_CONFLICT`。
- 计划创建在租户事务内执行 `SET LOCAL app.user_id`；`job_work_items` 启用并强制 RLS。
- 计划读取按 `sort_order + id` 游标分页，只读取工作项元数据，不加载章节正文。
- 全本/卷范围要求章节具备大纲节点和所属卷；连续区间要求章节号连续且都存在。
- 连续区间还要求区间之前的章节存在并已提交正史；缺失或未提交时返回 `BATCH_PLAN_INVALID` 并列出章节号。
- 步内顺序执行；同卷章节互相独立，失败章节不会在 DAG 层阻塞同卷兄弟章节；下一卷的章节依赖上一卷工作项，卷完成后进入卷边界审核；全书工作项依赖全部卷。
- 执行、暂停、恢复、重试、失败隔离、卷边界人工审核和成本硬停不在本 issue 内，由 #152 组合 #110/#115 已冻结原语实现。

## 3. 变更文件

- `packages/contracts/src/index.ts`
- `packages/core/src/batch-plan.ts`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0043_equal_xavin.sql`
- `apps/api/src/batch-plan/*`
- `apps/api/src/app.module.ts`
- `apps/api/openapi.json`
- `apps/api/src/generated/openapi.d.ts`

## 4. 验证证据

- `packages/core/test/batch-plan.test.ts`：4/4 通过。覆盖 40 卷 × 100 章 = 4,000 章、32,041 个工作项、稳定 key/ID、打乱输入后的确定性、随机规模 property 检查、DAG 非法图拒绝、并发上限和交互优先。
- `packages/contracts/test/batch-plan.test.ts`：2/2 通过。覆盖默认值、非法区间和重复步骤。
- `apps/api/test/batch-plan.integration.test.ts`：3/3 通过，连接真实 PostgreSQL 16 + Redis。覆盖：
  - 按章、按卷、连续区间、全本四种范围的创建、幂等重放、分页、跨租户读写拒绝和独立 repository 重启后读取；
  - 非连续区间、区间前序正史未提交与非法卷拒绝；
  - 4,000 章最大拓扑、32,041 个工作项、并发同 key 创建只产生一条父任务。
- `pnpm check`：格式、Lint、全仓类型检查和单测通过（见最终提交记录）。
- OpenAPI：`pnpm --filter @novel-brain/api openapi:generate` 已重新生成 `openapi.json` 与 `openapi.d.ts`。

## 5. 已知边界

- 本 issue 不执行工作项，也不把工作项投递到 BullMQ。
- 计划创建允许较长事务（批量计划 repository 使用 30 秒查询/语句上限），避免 2 秒通用 CRUD 上限阻断 4,000 章计划或并发幂等等待。
- `#152` 仍需实现工作项领取、暂停/恢复/重试、失败隔离、卷边界审核与成本硬停。
