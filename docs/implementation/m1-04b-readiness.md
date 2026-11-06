# M1-04b 开书/生成准备度门禁与修复路径

> Issue: #148  
> Capabilities: ONBOARD-008, PLAN-005  
> Branch: `codex/m1-148`

## 实现范围

- 新增统一 `readiness-v1` 规则，覆盖故事圣经、结构化世界规则、已锁定设定、角色/POV、五层大纲、章纲与必要事实、正文模型、生成预算和高风险审批。
- 输出区分 `blocker` 与 `warning`，每项带稳定 `key`、资源类型/ID/版本、证据、依赖版本和精确修复地址。
- 依赖指纹覆盖分支版本头、故事圣经版本、设定/提案版本、大纲节点、章节版本、模型配置和预算；同一输入确定性复现，任一依赖或规则版本变化都会使旧结果失效。
- 新增 `GET /api/v1/works/:workId/branches/:branchId/readiness`，可带 `chapterId`、`modelConfigId` 和预算参数；无章节时为开书检查，有章节时为生成前检查。
- `POST /chapters/:chapterId/generate` 在创建 Job 前复用同一规则；存在阻断项时返回 `409 GEN_READINESS_BLOCKED`，并携带规则版本、依赖指纹和阻断项。
- 现有 `work.readiness`、章节 readiness 和大纲 readiness 保留原响应形状，但改为统一结果的适配器，避免继续扩展多套准备度真源。
- 总览和写作台展示缺项/提醒并可跳到故事圣经、设定栏目/实体、大纲节点、模型配置或写作台对应锚点。
- 设定页读取 `column`/`entityId`，大纲页读取 `nodeId`，使修复链接落到具体资源。

## 规则与边界

- 故事圣经必须锁定且九卡无冲突；世界铁律必须存在结构化规则。
- 世界规则、人物、金手指必须锁定；POV 必须能匹配已锁定人物；章纲必须包含必要事实。
- 有章节但尚无五层大纲时，保留 M0 直接章纲生成路径；创建五层大纲后，结构、卷契约、章节点和场景卡进入准备度检查。
- 模型缺失或连接失败为阻断；未测试连接为提醒。
- 成本上限或 token 上限不是正值时阻断；极小但合法的预算仍由上下文编译/Worker 预算硬停，保持 M0 语义。默认预算与写作台当前生成请求一致。
- 待处理设定提案、待确认高风险事实和高风险修改会阻断；不会静默补事实或自动通过审批。
- 跨租户作品、分支或章节访问返回 `403 FORBIDDEN_TENANT_ACCESS`。

## 契约与数据

- 共享 Zod/OpenAPI 契约位于 `packages/contracts/src/index.ts`：`generationReadinessSchema`、`generationReadinessQuerySchema`、`generationReadinessResponseSchema`。
- 纯规则位于 `packages/core/src/readiness.ts`：`evaluateGenerationReadiness`、`isReadinessStale`、`READINESS_RULE_VERSION`。
- API 位于 `apps/api/src/readiness`，仓储在一次租户事务中读取作品、分支、故事圣经、设定、提案、风险、章节、大纲与模型配置。
- 本 ticket 不新增持久化表或迁移；准备度按当前真源即时求值，响应中的依赖指纹用于识别旧结果。

## UI

- `apps/web/components/readiness-remediation.tsx` 统一渲染阻断/提醒、理由、证据和修复链接。
- `work-overview` 展示开书缺项与提醒；`writing-workspace` 展示章级缺项与提醒，并在生成前重新求值，避免用陈旧准备度放行。
- `apps/web/e2e/parity/readiness.spec.ts` 覆盖 missing/locked/partial/conflict/ready、精确跳转、四档视口、无横向溢出、跨租户拒绝和作者语言扫描。

## 验证

- `pnpm exec vitest run packages/core/test/readiness.test.ts`
- `pnpm exec vitest run packages/contracts/test/contracts.test.ts`
- `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/readiness.integration.test.ts apps/api/test/chapters.integration.test.ts apps/api/test/works.integration.test.ts apps/api/test/generation.integration.test.ts`
- `pnpm exec playwright test apps/web/e2e/parity/readiness.spec.ts`
- `pnpm --filter @novel-brain/api openapi:generate`
- 集成/E2E 使用独立 `novelbrain_test_148_<随机后缀>` / `novelbrain_e2e_148_<随机后缀>` 数据库与独立 Redis DB。

## 风险

- 准备度为即时求值，不做服务端缓存；高并发下会重复读取依赖表，后续如加缓存必须使用 `dependencyFingerprint` 做失效键。
- 当前高风险审批来自待处理高风险故事圣经修改、待处理设定修改和本章高风险事实；更完整的审批策略仍由后续批量/变更 ticket 负责。
- 预算修复链接指向写作台生成区；当前写作台仍使用固定请求预算，若后续增加预算编辑器需同步更新 target 语义。
