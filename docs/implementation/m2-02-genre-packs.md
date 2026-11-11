# M2-02 历史与都市题材包

> Issue：#92
> Capability：ONBOARD-003、SET-001、SET-002、SET-006
> Branch：`codex/m2-92`
> Date：2026-11-11

## 1. 实现范围

- `genre_packs` 扩展字段 schema、结构化规则、UI hints、生成指导和迁移元数据。
- 仙侠、架空历史、都市各提供 v1/v2 不可变版本；新作品固定绑定当前最新版本。
- 所有作品创建模式都绑定题材包；模板模式要求 `templateKey` 与作品 `genre` 一致。
- 新增题材包读取接口和作品版本切换接口；升级/回滚写入 immutable `version_nodes`、审计和幂等记录。
- 故事圣经按题材生成不同世界规则、人物原型和冲突种子，不再限制为仙侠。
- new-project 支持三题材模板；settings 展示题材包版本并调用真实升级/回滚动作。

## 2. API

- `GET /api/v1/genre-packs?key=xianxia|history|urban`
- `POST /api/v1/works/:workId/genre-pack/version`
- 错误码：`GENRE_PACK_VERSION_NOT_FOUND`

版本切换请求：

```json
{
  "targetVersion": 1,
  "reason": "回滚到旧版字段"
}
```

## 3. 数据与语义

- `genre_packs` 的 `(key, version)` 唯一，pack 内容不可原地修改版本语义。
- 作品通过 `works.template_pack_id` 固定 pack version。
- 版本切换在 work 行锁内校验租户和版本，更新 pack 引用与 `works.settings.genrePack` 快照。
- 切换时生成 migration report，记录 from/to version、missing fields、removed fields 和 conflicts。
- 每次实际版本变化创建新的 `snapshot` version node，并保存 previous/target pack、原因和 actor。
- 同一 Idempotency-Key 重放不会重复创建 version node 或 audit；同 key 不同请求返回冲突。
- 历史题材禁止修仙境界/法术/宗门；都市题材禁止宗门修炼与境界突破。

## 4. UI

- `apps/web/components/new-project-wizard.tsx`：三题材模板来自真实 pack API。
- `apps/web/components/settings-center.tsx`：展示 pack label/version，支持真实版本切换。
- `entity-detail` 的力量层级、寿命绑定和层级历史文案由 pack `uiHints.powerLevelLabel` 驱动。
- `apps/web/components/story-bible.tsx`：三题材均可生成、编辑和锁定。

## 5. 验证

- `packages/contracts/test/genre-pack.test.ts`
- `apps/api/test/works.integration.test.ts`
- `apps/api/test/story-bible.integration.test.ts`
- `apps/api/test/manuscript-import.integration.test.ts`
- `apps/api/test/settings-import.integration.test.ts`
- `apps/web/e2e/parity/new-project.spec.ts`
- `apps/web/e2e/parity/settings.spec.ts`
- `apps/web/e2e/parity/entity-detail.spec.ts`：仙侠、历史、都市四档视口力量层级文案。
- `apps/web/e2e/parity/bible.spec.ts`

## 6. 视觉与边界

- settings/bible 新增 pack 版本栏和历史题材故事圣经后，旧 production golden 不再代表当前布局。
- 作者已确认 `artifacts/ui/candidates/m2-92/` 的 settings/bible 四档候选截图；正式 Linux/CI golden 已生成，settings 4 张更新，bible 4 张保持当前正式基线。
- entity-detail 仍为 `production-built`，其题材化层级文案等待单独视觉签收。
- 不实现题材包后台编辑器；题材包版本由受控迁移发布。
- 不实现自动整库字段重写；版本切换只更新作品 pack 引用和默认字段快照，作者设定与历史版本保持不变。
