# M1 Spec 集成验收记录

> Spec: #80 完整仙侠创作闭环
> Integration branch: `codex/m1-full-loop`
> Verified code HEAD: `69fada1`
> 日期: 2026-11-08

## 2026-11-08 集成加固与当前证据

在当前 integration branch 上追加并合并了以下修复：

- `#112`：未传显式版本点时按目标章节当前版本解析检索边界；目标章节缺失或没有章节版本时失败关闭，排除未来实体、关系和知识。
- 成本硬停：provider 请求的 `maxTokens` 与 reservation 使用同一预算；超支在同一事务中记录实际 usage/cost、usage record、失败轨迹和 `job.budget.exceeded`，停止后续调用并保持重投幂等。
- `#144`：设定实体和自定义字段使用游标分页；所有消费方完整拉取分页；恢复旧版本会创建新 `rollback` 节点并精确恢复实体、角色档案和自定义字段，锁定内容仍走修改请求门禁；查询参数 OpenAPI 由共享 Zod schema 生成。
- `#112` 补充角色认知的 `versionNode` 祖先链过滤，避免后续版本知识进入旧版本上下文。
- 成本硬停补充共享预算执行器、可恢复暂停状态、显式预算恢复、usage/cost 原子入账和定向修订轮次同事务收尾。
- `#144` 补充实体版本历史发现、proposal/change-request 分页，以及人物、势力、时间线和力量体系的完整领域投影恢复。
- 写作台：生成任务尚未完全结束时，质量检查和声线检查按钮不再显示为可执行；消除点击被静默忽略的状态。
- 事实提交在同一事务内按章节 POV 写入角色知识状态，不再依赖测试或人工补写投影。
- 检索索引移除数据库生成的业务 `id`，改用来源、版本和分支组成的复合主键；触发器和检索排序同步迁移。
- 角色知识查询与物品卸下请求的 DTO 收回 `packages/contracts`；角色与世界仓储复用统一 tenant transaction helper。
- 写作台错误状态不再向作者展示内部错误码，保留可读失败原因和断点重试入口。
- M2 batch plan、执行队列、`job_work_items` 迁移和验收文档已从 M1 树中移除，并保留在独立 stacked M2 分支；拆分清单见 `m1-m2-scope-split.md`。

当前自动化证据：

- `pnpm check`：42 个测试文件、257 项测试通过；M2 batch 单元/契约测试已移出 M1。
- `pnpm test:integration`：25 个测试文件、164 项测试通过；M2 batch integration 已移出 M1。
- `pnpm exec playwright test --grep-invert "checks every M0 parity page"`：99 项通过，1 项已知恢复时序用例超时；该用例单跑通过，最终以 PR CI retry 结果为准。
- `pnpm --filter @novel-brain/api openapi:check`：通过。
- `node scripts/validate-readiness.mjs`：通过；119 个能力、119 个主 issue 映射、85 节点/318 blocker edges 无环。

仍未完成的签收门禁：

- M1 生产 golden、作者视觉签收与真实样片产品验收仍未完成。
- `#142` 作品设置/复制存在独立 worktree 实验实现，但规范依赖仍含未完成的 `#134`，且复制边界与单一版本图仍有未决问题，因此未合入当前 integration branch。
- 黄金三章 ADR 0007 与当前“每个候选固定三章”的契约仍冲突；按 accepted ADR 拆分第一候选与第二三章续写的工作由 `#162` 跟踪。
- 黄金三章当前仍使用 deterministic 模板生成和自动评审，真实作者模型与 ContextPack provenance 由 `#165` 跟踪。
- 通用设定 PATCH 的一等领域双真源由 `#166` 跟踪。
- `#80` 原文要求的“所有 list endpoint 使用 cursor pagination”在设定中心之外仍有缺口，由 `#163` 跟踪，不能据此关闭 spec。
- M2 batch 工作已从 M1 树中移出，独立验证和签收由 `#164` 继续跟踪。

## 已集成范围

- Story Bible / Settings: #143、#144
- World simulation: #106、#107、#108
- Outline / ledgers: #145、#146
- Golden Three / readiness: #147、#148
- Agent Runtime: #109–#115
- Writing / critique / revision / style: #116–#119
- Account completion: #141
- M1 volume audit and full-loop acceptance: #90

所有叶子 ticket 均通过各自的功能提交和 merger commit 进入同一 integration branch；没有引入微服务、第二版本图或 Web 直连模型。

## 最终自动化证据

- `pnpm check`: format、lint、typecheck、250 项单元/契约测试通过。
- `pnpm test:integration`: 25 个文件、142 项真实 PostgreSQL/Redis 集成测试通过。
- `pnpm exec playwright test --grep-invert "checks every M0 parity page"`: 93 项通过，覆盖全部 M1 页面四档视口、M1 全链路、M0 回归旅程、作者语言和后端故障恢复。
- `pnpm --filter @novel-brain/api openapi:check`: 通过。
- `node scripts/validate-readiness.mjs`: 通过。

## 已修复的整体审查问题

- 无新鲜质量报告时禁止批准章节和提交事实，P0/P1 继续阻断。
- 黄金三章增加 3 候选生成入口与 provenance/版本 pin；当前 provider 仍为 deterministic，不能当作真实模型生成签收。
- 锁定设定修改请求返回并展示影响资源提示。
- M1 全链路 Playwright 改为真实 UI 主路径，不再只依赖 API fixture 展示。
- 新增 API 列表游标分页、创建幂等键、撤销版本校验和统一 tenant transaction helper。
- 修复 canon 同章新幂等键/新章节版本误返回旧提交的问题。
- 统一质量/审计严重度文案，并同步 prototype contract。

## 尚未完成的人工/后续门禁

- M1 页面生产 golden 仍需按 ADR 0027 重新拍摄和作者签收：bible、settings、entity-detail、outline、foreshadows、writing、work-overview、account-settings。#143 保持未关闭。
- M0 golden 截图用例未纳入本次“全绿”计数，因为其基线仍是旧页面；需与 M1 golden 一起重新签收。
- #142 作品设置/归档恢复/复制仍被 #134 的永久删除与生命周期契约阻塞；本分支未绕过该依赖实现不可逆删除。
- 真实 DeepSeek 仍只走独立 gated smoke，不进入普通测试套件。
