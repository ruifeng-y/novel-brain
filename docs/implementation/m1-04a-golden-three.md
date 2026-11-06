# M1-04a 黄金三章候选、六维评审与锁定

> Issue: #147  
> Capabilities: PLAN-003, GEN-009  
> Branch: `codex/m1-147`

## 实现范围

- 同一创作线可一次登记 2–3 个黄金三章候选；每个候选固定第 1、2、3 章的章节版本、内容指纹、版本节点和正文快照。
- 候选固定 prompt、模型、模型参数、上下文快照与 manifest 指纹；不记录明文 provider key、prompt 正文或完整上下文。
- 候选登记只读取既有章节版本，不更新章节当前版本、状态或正文，避免候选生成覆盖既有章节。
- 六维固定为开篇钩子、主角吸引力、世界规则展示、核心冲突、读者承诺、章末追读钩子；每维保存 1–5 分、评审来源、证据原文和定位。
- 证据必须来自该候选固定的章节版本原文；伪造、跨候选或跨章节证据会被拒绝。
- 作者可选择候选；锁定前必须完成六维评审，所有必需维度达到 4/5。未达标时返回失败维度并阻断锁定。
- 显式例外只接受 `author_override_v1`，必须记录至少 10 个字符的理由；锁定记录保存评审快照和例外理由。
- 锁定写入统一版本图的 `snapshot` 节点，推进分支头，并通过 `audit_logs` 记录候选选择与锁定。
- 锁定同时生成不可变 `style_baselines` 记录，保存选定方向、三段开篇样本和锁定节点引用，供后续风格基线消费。
- 所有候选、评审、锁定与风格基线查询和写入均带用户、作品、分支条件，并启用 RLS。

## API 与契约

- `GET /api/v1/works/:workId/branches/:branchId/golden-three`
- `POST /api/v1/works/:workId/branches/:branchId/golden-three/candidates`
- `PUT /api/v1/works/:workId/branches/:branchId/golden-three/candidates/:candidateId/reviews`
- `POST /api/v1/works/:workId/branches/:branchId/golden-three/candidates/:candidateId/select`
- `POST /api/v1/works/:workId/branches/:branchId/golden-three/candidates/:candidateId/lock`
- 候选批次使用 `Idempotency-Key`；重复请求返回同一批候选，不重复追加版本节点。
- 共享契约位于 `packages/contracts/src/index.ts`，OpenAPI 已重新生成。

## UI

- outline 页新增“黄金三章”视图，支持候选正文并排比较、六维评分与证据比较、作者选择、失败阻断、例外理由和锁定成功态。
- `apps/web/e2e/parity/golden-three.spec.ts` 覆盖 390/900/1180/1440 四档视口、无横向溢出、真实 API 动作和作者语言扫描。
- outline 页仍为 `production-built`；M0 的 outline 生产 golden 不能代表 #145/#147 后的新布局，需重新拍摄并完成作者视觉签收后才能升级为 `parity-verified`。

## 验证

- `pnpm exec vitest run packages/contracts/test/golden-three.test.ts`
- `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/golden-three.integration.test.ts`
- `pnpm --filter @novel-brain/api typecheck`
- `pnpm --filter @novel-brain/web typecheck`
- `pnpm --filter @novel-brain/api openapi:generate`
- 独立数据库 `novelbrain_test_147_<随机后缀>`、独立 Redis DB 与独立 E2E 数据库/Redis DB 执行聚焦测试。

## 边界与风险

- 本 ticket 消费已生成的章节版本，生成候选文本与调用模型的通用写作流程仍由既有生成链路/#116 负责；#147 负责候选封装、provenance、评审门禁和锁定。
- 同一创作线只允许一批黄金三章候选；需要重新开篇时走新的创作线或后续平行版本流程。
- 锁定不会重写正文；它把作者选定的已 pin 章节版本设为章节当前版本并状态锁定，原历史版本保持不变。
- 开发机安装的 Chromium 与字体环境不等于 ADR 0027 的 CI golden 环境；本轮只提交生产 Playwright 行为与响应式证据，不冒充作者视觉签收。
