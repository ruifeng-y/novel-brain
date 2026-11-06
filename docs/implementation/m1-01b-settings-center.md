# M1-01b 七栏设定中心、实体别名与自定义字段

> Issue: #144
> Capability IDs: SET-001, SET-002, SET-011, SET-012
> UI parity matrix: settings

## 实现范围

- 七个顶层栏目全部使用真实实体数据：世界、势力、人物、地图、力量体系、物品功法、时间线。
- 通用实体目录新增 `item` 与 `timeline_event` 类型，保留人物、地图、势力等专用模型由 #106–#108 接续的边界。
- 规范名在同一作品分支内按类型唯一；别名在作品分支内跨类型唯一。名称和别名会做 NFKC、空白归一和小写比较，同名不同类型通过类型消歧。
- 自定义字段支持文本、长文本、数字、日期、单选、多选、布尔和关系引用；定义带类型约束、选项唯一性、启停和 `schemaVersion`，值在写入时按定义校验。
- 关系引用只允许指向同作品分支内存在且类型匹配的实体。
- 设定状态支持草稿、提案、锁定、废弃。提案记录冲突类型、理由、来源证据、提交者和裁决信息；待裁决设定不能直接编辑、锁定或删除。
- 锁定设定拒绝直接字段、别名和删除修改，只能创建带标题、原因、旧值、新值、冲突类型和证据的修改请求。
- 所有设定、自定义字段、提案和修改请求查询与写入都带用户、作品和分支条件；跨租户读取和写入失败关闭。

## 数据与契约

- 新增 `custom_field_definitions`、`custom_field_values`、`setting_proposals`、`setting_change_requests`。
- 四张新表启用并强制 RLS，租户上下文使用 `app.user_id`。
- `entities_type_check` 扩展 `item` 与 `timeline_event`；自定义字段适用对象与关系目标同步扩展。
- 共享 Zod 契约新增物品、时间线事件、自定义字段、提案、裁决和修改请求；OpenAPI 与派生 TypeScript 类型已重新生成。
- 修正 patch/修改请求的可选字段默认值，避免未提交的别名、描述或标签被静默清空。

## 验证接缝

- 契约：`packages/contracts/test/contracts.test.ts`。
- API：`apps/api/test/settings.integration.test.ts`，使用真实 PostgreSQL/Redis 与 Nest HTTP 路由。
- Web：`apps/web/e2e/parity/settings.spec.ts`，使用真实 API 数据。
- 数据：集成测试直接断言四张新表的 `relrowsecurity`、`relforcerowsecurity` 与策略存在。

## 验证结果

- `pnpm exec vitest run packages/contracts/test/contracts.test.ts`：20 项通过。
- `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/settings.integration.test.ts`：16 项通过（独立全新测试库）。
- `pnpm exec playwright test apps/web/e2e/parity/settings.spec.ts`：7 项通过，覆盖七栏 CRUD、自定义字段、提案裁决、锁定修改请求，以及 empty/locked/proposal/long/error 在 390/900/1180/1440 四档视口。
- `pnpm --filter @novel-brain/api openapi:generate`：通过，生成 `proposals`、`decision`、`change-requests` 与 `custom-fields` 路由。
- `pnpm --filter @novel-brain/api typecheck`、`pnpm --filter @novel-brain/web typecheck`、`pnpm --filter @novel-brain/db build`：通过。

## 边界与遗留

- 人物、势力、地图、力量体系、物品和时间线的专用领域表仍由 #106–#108 承担；本 ticket 只落通用目录、别名、自定义字段和状态基线。
- 修改请求当前记录为待分析状态；影响分析、批准、应用和撤销由 M2 #120–#122 承担。
- settings 页面新增 M1 交互后，生产 golden 需要按 ADR 0027 重新生成并由作者签收；parity matrix 已回退为 `production-built`。
