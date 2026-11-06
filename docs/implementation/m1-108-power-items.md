# M1-02c 力量体系、特殊机制与物品资源域

> Ticket: #108  
> Branch: `codex/m1-108`  
> Capabilities: SET-006, SET-007, SET-008

## Delivered

- `power_systems` / `power_paths` / `power_realms`：多路径力量体系，境界层级、突破条件、代价、瓶颈、克制与被克制，均可独立配置。
- `power_systems.lifespan_*` 与 `power_realms.lifespan_amount`：寿命可配置为不绑定、按境界、固定值或自定义规则，未写死仙侠语义。
- `special_mechanisms` / `mechanism_ownership_events`：特殊机制规则、代价、限制、成长、所有者与可审计所有权历史。
- `item_techniques` / `item_rights`：物品、功法、装备、资源四类；归属、保管、位置、使用权、处置权为独立记录，带有效期、原因、证据与版本节点。
- 共享/唯一归属、消耗品数量、装备位冲突、耗尽物品不可再授权等不变量在 core 纯函数、契约和 API 三层校验。
- 所有写入追加唯一 `version_nodes` 图并更新实体版本；锁定后直接写入返回 `SETTING_LOCKED`，修改请求支持 `powerSystem`、`mechanism`、`item` 类型化载荷。
- 新表均启用 `FORCE ROW LEVEL SECURITY`，迁移回填既有力量体系、金手指和物品实体。

## API

- `GET/POST /api/v1/works/:workId/branches/:branchId/world/power-systems`
- `GET/PATCH /world/power-systems/:id`、`POST /power-systems/:id/paths`、`POST /power-systems/:id/paths/:pathId/realms`
- `GET/POST /world/mechanisms`、`GET/PATCH /world/mechanisms/:id`、`POST /world/mechanisms/:id/ownership-transfers`
- `GET/POST /world/items`、`GET/PATCH /world/items/:id`、`POST /world/items/:id/rights|consume|equip|unequip`
- `world/snapshot` 返回值新增 `powerSystems`、`mechanisms`、`items`

## Evidence

- `pnpm test`：15 files / 126 tests passed。
- `pnpm test:integration`：14 files / 90 tests passed，含跨租户与 7 张新表 RLS 检查。
- `pnpm --filter @novel-brain/api openapi:generate`：OpenAPI 与生成类型已更新。
- `pnpm exec playwright test apps/web/e2e/parity/settings.spec.ts apps/web/e2e/parity/entity-detail.spec.ts`：17 tests passed，覆盖 390/900/1180/1440 四档与 locked/proposal/long/error 状态。
- `pnpm lint`、`pnpm typecheck`：通过。

## Residual Risk

- 迁移 `0029_power_items.sql` 在生成后补了 RLS 与回填语句；已用全新数据库验证，但已有环境需按正常迁移顺序应用。
- 通用 `PATCH /entities/:id` 仍可写旧 `attributes` 投影；生产 UI 已改走专用域 API，后续可由 #144 统一收紧或迁移。
- 视觉 golden 尚未由作者重新签收，parity 状态保持 `production-pending`。
