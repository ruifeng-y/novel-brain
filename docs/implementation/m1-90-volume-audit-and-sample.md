# M1-07 卷级审计、仙侠样片与 M1 全链路验收

> Issue: #90
> Capability: QUALITY-005
> UI parity: work-overview（卷末审计）、bible、settings、entity-detail、outline、foreshadows、writing、account-settings
> Status: implementation, automated acceptance and author page visual sign-off complete; fixed-sample product acceptance remains pending.

## 1. 交付范围

- 新增共享契约 `m1-volume-audit-v1`：卷末审计报告、Finding 读取模型、覆盖清单、汇总、作者签收与乐观锁。
- 新增纯规则 `evaluateVolumeAudit`，覆盖：
  - 未收束剧情线、伏笔和人物弧；
  - #117 章节检查中的动机断裂、时间线冲突、地点冲突和角色知识泄露；
  - 反派在占优时主动削弱追击、放走主角或放弃补刀的降智模式；
  - 同一章连续跨越两个境界，或三章内跨两级以上的战力膨胀；
  - 章节顺序与故事时间倒置；
  - 尚未保存正文的章节。
- Finding 复用 #117 的 `criticEvidenceSchema`、`criticSourceRefSchema`、`criticAffectedObjectSchema`、严重度、维度与建议字段；来自章节检查的问题保留 `upstreamFindingId`，可从卷级问题回到原 Finding。
- 新增 `volume_audit_reports` 表与 RLS。报告记录输入 source hash、章节覆盖、Finding、签收结论、签收人和签收时间。
- 新增 API：
  - `GET /works/:workId/branches/:branchId/volume-audits`
  - `POST /works/:workId/branches/:branchId/volume-audits`
  - `POST /works/:workId/branches/:branchId/volume-audits/:auditId/signoff`
- work-overview 新增真实“卷末审计”面板：选择卷、运行审计、查看证据定位、跳转写作台、记录通过或要求修改。
- 签收门禁：存在阻断项不能“通过”；黄金三章未锁定不能“通过”；章节版本在审计后变化时报告失效，必须重新审计。

## 2. 固定仙侠样片

样片生成器：`apps/api/test/fixtures/m1-xianxia-sample.ts`

- 版本：`m1-xianxia-sample-v1`
- 固定 seed：`20261106`
- 章节数：40
- 固定字符数：122,696（10–15 万字区间）
- 固定 source hash：`b7df9ec5e031ac593f8c2d34dab08ddecf79ec94aee44e3aef09bd11dd285466`
- 样片不是模型即时生成或模型自评；内容、缺陷位置和 hash 都由固定 seed/version 决定。
- 样片中固定植入的可定位缺陷：第 8 章连续突破、第 12 章反派降智、第 20 章动机断裂、第 24 章知识泄露、第 30 章时间线冲突、第 31 章地点冲突，以及第 1 章埋下但卷末未收束的“父母之死”伏笔。

## 3. 验收证据

### 卷末审计规则

```bash
pnpm build:packages
pnpm exec vitest run packages/contracts/test/volume-audit.test.ts packages/core/test/volume-audit.test.ts
```

### API 端到端报告

```bash
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/volume-audit.integration.test.ts
```

该测试使用 `novelbrain_test_90_<随机后缀>` 专用 PostgreSQL 数据库和独立 Redis DB，覆盖：

- 建作品、故事圣经、七栏设定、五层大纲、黄金三章锁定；
- 40 章 122,696 字固定样片写入；
- #117 章节检查与卷末审计联合读取；
- 未收束伏笔、动机断裂、反派降智、战力膨胀、时间线/地点冲突、知识泄露均可定位到证据；
- 同输入重复审计得到相同 source hash；
- 阻断报告不能签收通过、修改意见可签收、正文变化后签收返回 stale；
- 无阻断卷可以完成作者签收；
- 跨租户访问返回 `FORBIDDEN_TENANT_ACCESS`。

### M1 全链路与页面 parity

```bash
pnpm test:e2e -- apps/web/e2e/parity/m1-closeout.spec.ts
```

覆盖建作品、故事圣经、七栏设定、五层大纲、黄金三章、写作、事实处理、卷末审计与作者修改意见；另对 bible/settings/entity-detail/outline/foreshadows/writing/work-overview/account-settings 在 390/900/1180/1440 四档视口检查真实路由、作者语言、横向溢出和正式生产 Golden 对比。

## 4. Golden 与人工签收

| 页面 | Playwright | 生产 golden | 状态 |
| --- | --- | --- | --- |
| work-overview | `work-overview.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/work-overview/` | parity-verified |
| bible | `bible.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/bible/` | parity-verified |
| settings | `settings.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/settings/` | parity-verified |
| entity-detail | `entity-detail.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/entity-detail/` | parity-verified |
| outline | `outline.spec.ts`、`golden-three.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/outline/` | parity-verified |
| foreshadows | `foreshadows.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/foreshadows/` | parity-verified |
| writing | `writing.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/writing/` | parity-verified |
| account-settings | `account-settings.spec.ts`、`m1-closeout.spec.ts` | `artifacts/ui/golden/account-settings/` | parity-verified |

以上页面的正式 Golden 与作者视觉签收已由 #172/#174/#176/#177 和 `docs/ui/v1-prototype-signoff.md` 补齐，当前均为 `parity-verified`。

页面视觉签收已完成，但固定 40 章仙侠样片与卷末审计结果的产品签收记录仍未产生。集成测试中的签收动作只验证 API 状态机和审计日志，使用测试账号，不代表产品作者签收。#90 保持 OPEN 直到作者在真实产品流程中完成该最终签收。

## 5. 已知边界

- 反派降智和战力膨胀是确定性保守规则，依赖正文明确句式和结构化境界名称；复杂反讽、不可靠叙述和有意失智能仍需作者判断。
- 卷末审计只能复用已运行的 #117 章节检查；未运行章节检查的章节会出现在覆盖清单中，但不会凭空生成章节级连续性 Finding。
- 本 ticket 不实现 M2 批量卷审计任务、M3 长线连续性基准或真实读者数据。
