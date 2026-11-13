# M1-04a 黄金三章候选、六维评审与锁定

> Issue: #147  
> Capabilities: PLAN-003, GEN-009  
> Branch: `codex/m1-147`

> 2026-11-09 #162 调整：候选只固定第 1 章；作者选定后登记第 2、3 章续写，续写节点存在后才允许锁定。候选、选择、续写和锁定分别写入不可变版本节点。

> 2026-11-09 #165 调整：候选生成使用作者绑定的写作模型和 ContextPack 编译结果，记录生成 job、prompt 版本、agent run、model call、成本与 usage provenance；确定性 fake 只在测试 seam 使用。

## 实现范围

- 同一创作线可一次登记 2–3 个第一章候选；每个候选固定第 1 章的章节版本、内容指纹、版本节点和正文快照。
- 作者选定方向后登记第 2、3 章续写；锁定合并第 1–3 章，未登记续写时门禁返回 `CONTINUATION_REQUIRED`。
- 续写版本节点引用选定候选、选择版本节点、第一章章节版本与内容指纹，并保存受限风格摘录来源；工作区响应同步返回该来源引用。
- 候选固定 prompt、模型、模型参数、上下文快照与 manifest 指纹；不记录明文 provider key、prompt 正文或完整上下文。
- 候选登记只读取既有章节版本，不更新章节当前版本、状态或正文，避免候选生成覆盖既有章节。
- 模型生成请求由 API 持久化 queued job 后立即返回 `202 + jobId`；Worker 消费 typed job，保存真实 provider/model、prompt hash、ContextPack manifest、模型调用和生成轨迹引用。job、ContextPack、prompt、agent run、cost reservation 和 model call 在模型调用前落库，成功结算、失败释放。
- 生成预算按每个候选的完整 ContextPack 输入和最大输出累计；模型失败返回可恢复错误，不写入模板候选。
- 同一幂等键重放原失败类型；同一创作线只允许一个活跃生成任务。每个模型步骤成功后写 `job_steps`、`job_step_attempts` 与 checkpoint，失败时释放未用 reservation 并保留已结算成本。
- 黄金三章使用路径级数据库幂等键；迁移回填历史 job。超过时限的 `running` job 会自动失败、释放预留并允许新任务恢复；每次结果写回与最终提交都校验 lease 版本，旧执行链不能覆盖恢复后的任务。
- generate API 不再在 API 进程调用 provider；Web 通过 `GET .../golden-three/generation/:jobId` 轮询状态并在完成后重新读取候选工作区。Worker 从结构化 checkpoint 恢复，已成功的候选步骤不会重复调用模型或重复计费。
- 模型生成的候选状态保持 `draft`，不自动伪造六维评分；六维评审必须通过独立评审入口提交。
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
- `POST /api/v1/works/:workId/branches/:branchId/golden-three/candidates/:candidateId/continuation`
- `POST /api/v1/works/:workId/branches/:branchId/golden-three/candidates/:candidateId/lock`
- 候选批次使用 `Idempotency-Key`；重复请求返回同一批候选，不重复追加版本节点。
- 共享契约位于 `packages/contracts/src/index.ts`，OpenAPI 已重新生成。

## UI

- outline 页新增“黄金三章”视图，支持候选正文并排比较、六维评分与证据比较、作者选择、失败阻断、例外理由和锁定成功态。
- `apps/web/e2e/parity/golden-three.spec.ts` 覆盖 390/900/1180/1440 四档视口、无横向溢出、真实 API 动作和作者语言扫描。
- outline 页生产 Golden、四档视觉签收与 Linux/CI 回归已由 #174、`docs/ui/v1-prototype-signoff.md` 和 parity matrix 补齐，当前状态为 `parity-verified`。

## 验证

- `pnpm exec vitest run packages/contracts/test/golden-three.test.ts`
- `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/golden-three.integration.test.ts`
- Golden Three 集成测试覆盖 queued API 返回、无 provider 调用、Worker 中断、checkpoint 续跑、lease loss、幂等 replay 和成本一致性。
- `pnpm exec playwright test apps/web/e2e/parity/golden-three.spec.ts`
- `pnpm test:e2e:m1-closeout-stability`
- Candidate, review, continuation or lock-gate changes must run both the page spec and the five-repeat M1 author-loop stability command.
- `pnpm --filter @novel-brain/api typecheck`
- `pnpm --filter @novel-brain/web typecheck`
- `pnpm --filter @novel-brain/api openapi:generate`
- 独立数据库 `novelbrain_test_147_<随机后缀>`、独立 Redis DB 与独立 E2E 数据库/Redis DB 执行聚焦测试。

## 边界与风险

- 本 ticket 消费已生成的章节版本，生成候选文本与调用模型的通用写作流程仍由既有生成链路/#116 负责；#147 负责候选封装、provenance、评审门禁和锁定。
- 同一创作线只允许一批黄金三章候选；需要重新开篇时走新的创作线或后续平行版本流程。
- 锁定不会重写正文；它把作者选定的已 pin 章节版本设为章节当前版本并状态锁定，原历史版本保持不变。
- 开发机安装的 Chromium 与字体环境不等于 ADR 0027 的 CI golden 环境；本轮只提交生产 Playwright 行为与响应式证据，不冒充作者视觉签收。
