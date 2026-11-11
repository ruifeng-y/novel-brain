# M1-06c 定向修订、作者反馈与修订差异

> Issue: #118
> Capability IDs: GEN-005, QUALITY-007
> UI parity matrix: writing

## 交付范围

- 从当前版本已确认的 P2/P3 非结构性 Finding 创建定向修订计划；P0/P1 和结构性问题仍走拒稿、重写或平行版本。
- 每个计划默认最多两轮，轮次上限和累计预算在 API 写入口与 Worker 成本预留两层执行。
- 每轮绑定不可变源版本、问题快照、正文块和作者约束；Worker 只替换选中块，不覆盖块外正文。
- 每轮生成不可变章节版本、`version_nodes` 节点、前后差异块与未解决 Finding 列表。
- 作者反馈记录接受、拒绝或再改写，包含原因、目标版本和乐观锁版本；默认不进入评估，只有 `evaluationOptIn=true` 才出现在评估反馈集合。
- 被拒绝的建议按章节持久化阻断，后续计划不能再次选中。
- 修订动作复用 #116 `write_action` envelope、#115 checkpoint、预算预留、重试和恢复协议，不另建任务/版本链。

## API

- `POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/revisions`
- `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/revisions`
- `GET /api/v1/works/:workId/branches/:branchId/revisions/:revisionPlanId`
- `POST /api/v1/works/:workId/branches/:branchId/revisions/:revisionPlanId/rounds`
- `POST /api/v1/works/:workId/branches/:branchId/revisions/:revisionPlanId/rounds/:roundId/feedback`

## 数据与迁移

- `packages/db/migrations/0039_panoramic_moon_knight.sql`
- 新增 `revision_plans`、`revision_rounds`、`revision_feedback_events`，均启用并强制 RLS。
- `writing_actions.action` 增加 `targeted_revision`；章节仍写入唯一版本图，反馈不进入故事正史。

## 门禁与不变量

- 已批准、已锁定、待审等不可编辑章节不能启动定向修订。
- 修订完成只把章节恢复为写作中，不自动批准章节、不确认事实、不提交正史。
- 章节批准仍读取 #117 质量门禁；事实提交仍要求批准章节和已确认事实。
- 拒绝的 Finding 不再作为新的修订选择；拒绝轮次保留原版本和差异供审计。

## 验证接缝

- 契约：`packages/contracts/test/revision.test.ts`
- 纯规则：`packages/core/test/revision.test.ts`
- API + Worker：`apps/api/test/revisions.integration.test.ts`
  - 专用 `novelbrain_test_118_<随机后缀>` 与独立 Redis DB
  - 两轮上限、累计预算入口、不可变版本、diff、未解决项
  - P0/P1、锁定章节、越界块、跨租户拒绝
  - 拒绝建议不可复活、反馈 opt-in、章节批准/事实提交门禁反例
- UI：`apps/web/e2e/parity/writing.spec.ts`
  - 选择低中风险问题、启动修订、查看前后差异、记录反馈
  - 修订后仍被章节批准门禁阻止
  - 390 / 900 / 1180 / 1440 四档无横向溢出与作者语言扫描

## 已知风险

- 未解决项采用“原始证据句是否仍存在”的确定性判定，复杂改写可能需要 #117 重新检查后再确认。
- 当前轮次上限固定为两轮；更高轮次需要新 ADR/产品决策，不能由客户端放宽。
- 生产 golden 尚未重新签收，writing 页保持 `production-built`。
