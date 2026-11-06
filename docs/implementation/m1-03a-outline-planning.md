# M1-03a 五层大纲、卷契约与场景卡

> Ticket: #145 · Branch: `codex/m1-145` · Integration: `codex/m1-full-loop`

## 交付范围

- 全书/卷/幕/章/场景五层节点，父子层级、同级顺序、单根节点和章节唯一引用约束。
- 拖动重排与上移/下移：同父重排和跨父移动；环、跨创作线、非法上级均被拒绝。
- 锁定/解锁：节点或任一上级锁定后拒绝结构修改、章纲/契约/场景卡保存和重排。
- 每次创建、编辑、重排、锁定、解锁、卷契约和场景卡保存都追加 `outline_version` 版本节点并写审计记录。
- 章节点只引用现有 `chapters`；章纲仍由 `chapters.brief` 持有，不复制正文或另造章节状态机。
- 卷契约记录目标、冲突、转折点、退出条件和相关剧情线。
- 场景卡记录有序节拍、POV、地点、故事时间、信息释放与知情边界、张力。
- 结构化 readiness 与 re-planning 影响结果，固定 `ruleVersion`。

## 契约与不变量

- `OutlineNode`、`VolumeContract`、`SceneCard`、`OutlineReadiness`、`OutlineReplanResult` 位于 `packages/contracts/src/index.ts`。
- 场景 POV 必须引用 `character`；地点必须引用 `map`、`map_node` 或 `territory`；引用必须属于当前创作线。
- 共享规则在 `packages/core/src/outline-planning.ts`：层级校验、环/重复顺序/章节重复检测、影响范围、准备度。
- 所有新表启用 `ENABLE/FORCE ROW LEVEL SECURITY`，策略按 `app.user_id` 隔离。

## 数据与迁移

- `packages/db/migrations/0032_striped_sasquatch.sql`（合并 #115 的 `0031_recovery_protocol` 后重新生成）
- 新表：`outline_nodes`、`volume_contracts`、`scene_cards`
- 关键索引：同级顺序唯一、每分支单全书根、每章节单节点、场景卡/卷契约一对一。
- 所有新表 `version_node_id` 外键指向唯一版本图；写入时先追加版本节点再写业务行。

## API

路径前缀：`/api/v1/works/:workId/branches/:branchId/outline`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 工作台：节点、卷契约、场景卡、准备度、统计 |
| GET | `/planning-readiness` | 结构化准备度（避免与 M0 `outline/readiness` 冲突） |
| POST | `/nodes` | 创建节点；章节点可引用现有章节或同时创建章节 |
| PATCH | `/nodes/:nodeId` | 编辑标题/摘要/状态/张力 |
| POST | `/nodes/:nodeId/move` | 重排或跨父移动 |
| POST | `/nodes/:nodeId/lock` | 锁定并追加版本 |
| POST | `/nodes/:nodeId/unlock` | 解锁并追加版本 |
| PUT | `/nodes/:nodeId/volume-contract` | 保存卷契约 |
| PUT | `/nodes/:nodeId/scene-card` | 保存场景卡 |
| POST | `/replan-check` | 返回稳定结构的影响范围、阻断项和提醒项 |

Web 代理 `apps/web/app/api/v1/[...path]/route.ts` 已补 `PUT` 转发，确保卷契约和场景卡保存可达 API。

## 页面与状态

- `apps/web/components/outline-workspace.tsx`：树状大纲、章节看板、张力曲线；节点详情、章纲、卷契约、场景卡编辑；拖拽/上下移动；锁定/解锁；准备度面板。
- `apps/web/e2e/parity/outline.spec.ts` 覆盖：
  - empty / tree / board / tension
  - partial readiness
  - locked
  - error
  - long outline
  - 390 / 900 / 1180 / 1440 四视口，无横向溢出，作者语言扫描。
- `docs/ui/v1-ui-parity-matrix.md` 中 outline 状态从 `parity-verified` 回退为 `production-built`，等待重新拍摄与作者视觉签收。

## 验证

- `pnpm test`：19 个测试文件、148 个测试通过。
- `pnpm typecheck`：全部工作区通过。
- `pnpm lint`：通过。
- `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/outline.integration.test.ts`：5/5 通过。
- `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/chapters.integration.test.ts`：5/5 通过。
- `pnpm exec playwright test apps/web/e2e/parity/outline.spec.ts`：4/4 通过。

## 已知风险

- 创建章节点时，“创建章节”和“创建大纲节点”分属两个事务；大纲节点创建失败会留下已创建章节。当前通过 API 错误返回和页面刷新暴露，未做跨模块补偿事务。
- 多文件同时运行集成测试会共享测试库并互相 `TRUNCATE`；本次验证按文件单独执行。该并发问题在既有 `works`/`chapters` 文件间同样存在，不属于 #145 引入。
- outline golden 仍为 M0 版本，已回退 parity 状态；重新签收前不能宣称视觉一致性完成。
- 剧情线账本、伏笔生命周期和黄金三章锁定属于 #146/#147，本次未实现。
