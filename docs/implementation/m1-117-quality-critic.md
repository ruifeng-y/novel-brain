# M1-06b 连续性/文风 Critic、六维质量报告与批注

> Issue: #117
> Capability IDs: GEN-004, QUALITY-001, QUALITY-002
> UI parity matrix: writing

## 交付范围

- 结构化 Finding 真源：维度、严重度、规则码、证据 span、来源引用、受影响对象、建议、状态、作者忽略理由和乐观锁版本。
- 固定版本 rubric：`m1-quality-rubric-v1`；固定规则版本：`m1-critic-rules-v1`。六维固定为章末钩子、节奏、信息密度、人物声纹、文笔、连续性，每维必须带正文证据。
- Critic 规则覆盖客观事实矛盾、时间线提前、未揭示角色认知、动机断裂、地点冲突和保守阈值的文风漂移；文风判断要求声线约束或已批准基线出现显著偏离，避免普通句式变化误报。
- 章节批准与正史提交分别读取同一 Finding 门禁：开放 P0/P1 阻断两者；结构冲突阻断正史提交；P2/P3 可由作者填写理由忽略并重新打开。
- `POST /chapters/:chapterId/verify` 生成不可变质量报告与 Finding；`GET /chapters/:chapterId/quality` 返回当前版本最新报告；`GET /chapters/:chapterId/annotations` 返回问题生命周期；`PATCH /annotations/:annotationId` 执行忽略/恢复并写审计。
- 参与证据读取的领域包括已确认事实、故事时间线、角色认知、章纲、地图地点和人物声线。Finding 行按章节和版本存储，可供 #90 卷级审计按章节集合复用。

## 数据与迁移

- `packages/db/migrations/0038_yummy_vision.sql`
- 新增 `quality_reports`、`quality_findings`，均启用并强制 RLS。
- Finding 不进入故事版本图；它属于派生审校记录，不修改正文或正史。

## UI

- `apps/web/components/writing-workspace.tsx` 增加真实“检查本章”动作、六维分数与证据、阻断门禁、Finding 建议/来源/状态、忽略理由表单和恢复入口。
- `apps/web/e2e/parity/writing.spec.ts` 覆盖检查、六维证据、P0/P1 阻断展示、P2 忽略/恢复生命周期与 390/900/1180/1440 四档无横向溢出。
- `docs/ui/v1-ui-parity-matrix.md` 的 writing 行增加 #117 支持范围；生产 golden 仍需按 ADR 0027 重新签收，不宣称整页 `parity-verified`。

## 验证接缝

- `packages/contracts/test/quality.test.ts`：Finding 字段、忽略理由约束、六维报告和下游门禁契约。
- `packages/core/test/critic.test.ts`：客观矛盾、未揭示知识、动机断裂、六类证据和文风误报控制。
- `apps/api/test/quality.integration.test.ts`：专用 `novelbrain_test_117_<随机后缀>` 与独立 Redis DB，验证报告持久化、批准/正史门禁、忽略/恢复、版本替代和跨租户拒绝。
- Playwright：writing 页真实 API 检查与批注生命周期。

## 已知风险

- Critic 规则是确定性保守基线，不能替代完整语义审校；复杂反讽、叙述性诡计和有意不可靠叙述仍需要作者判断。
- 当前六维评分用于结构化证据与门禁，不替代 #139 的固定基准集和发布级 rubric 阈值。
- #118 尚未实现，Finding 的“接受修改/让 AI 重写/要求解释”动作不在本 ticket 内。
