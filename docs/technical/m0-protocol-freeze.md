# M0 Protocol Freeze

> 状态：M0 编码前冻结
> 关联：ADR 0024、[M0 Spec #66](https://github.com/ruifeng-y/novel-brain/issues/66)
> 适用：M0 内部演示

## 1. 契约所有权

- `packages/contracts` 是请求、响应、错误、枚举和 OpenAPI 类型的唯一来源。
- Web、API、Worker 都从 `packages/contracts` 引用类型，不维护平行 DTO。
- 每个 M0 endpoint 必须有 Zod 输入/输出 schema 和至少一个契约测试。
- API 路由使用 `/api/v1`。破坏性变更必须新增版本或 ADR，不得静默改字段含义。

## 2. HTTP 通用协议

- `Content-Type: application/json; charset=utf-8`。
- ID 使用 UUID v7；由应用服务端在业务写入入口生成，客户端不得自行构造业务 ID。
- PostgreSQL 列不得再以 `gen_random_uuid()` 作为业务 ID 默认值；数据库负责持久化和唯一性约束，不负责生成另一种 ID。
- 时间为 UTC ISO 8601；作者界面按浏览器时区展示。
- 成功响应：

```json
{
  "data": {},
  "requestId": "req_...",
  "meta": {}
}
```

- 错误响应：

```json
{
  "error": {
    "code": "FACT_SUBMISSION_BLOCKED",
    "message": "章节尚未批准或仍有待确认事实",
    "details": {},
    "requestId": "req_..."
  }
}
```

- 列表使用游标分页：`cursor`、`limit`，响应 `meta.nextCursor`。
- 创建类请求支持 `Idempotency-Key`；同一用户、同一路径、同一 key 在 24 小时内返回同一结果。
- 更新类请求必须带 `version` 或 `If-Match`；版本冲突返回 `409 VERSION_CONFLICT`。
- 长任务写入使用 `202 Accepted` 并返回 `jobId`。
- SSE 事件包含 `eventId`、`type`、`occurredAt` 和 `data`；客户端断线后可按 `Last-Event-ID` 恢复。

## 3. 认证、Cookie 与 CSRF

- 会话使用 `HttpOnly`、`Secure`（生产）、`SameSite=Lax` Cookie。
- Cookie 名固定为 `nb_session`。
- 登录、注册成功时轮换会话 ID；登出立即撤销服务端会话。
- 所有 `POST/PATCH/DELETE` 必须校验 `Origin`，并校验 double-submit CSRF token。
- CSRF token 通过 `GET /api/v1/auth/csrf` 获取，放在 `X-CSRF-Token`。
- API Key 永远不出现在响应、Cookie、日志、SSE、导出包或错误详情中。

## 4. 错误码

错误码稳定、可机器判断，不以中文 message 作为判断依据。

| 前缀 | 用途 |
| --- | --- |
| `VALIDATION_` | 输入格式或业务必填项错误 |
| `AUTH_` | 登录、会话、验证码、限流 |
| `FORBIDDEN_` | 跨用户或无权操作 |
| `WORK_` | 作品和分支 |
| `MODEL_` | Provider、Key、连接测试 |
| `BIBLE_` / `SETTING_` | 故事圣经和最小设定 |
| `JOB_` | 任务状态和检查点 |
| `GEN_` | 生成和上下文编译 |
| `FACT_` | 事实决策和提交门禁 |
| `CANON_` | 故事事实提交和版本节点 |
| `IMPORT_` | 设定导入、旧稿导入和冲突 |
| `RATE_LIMIT_` | 接口限流 |
| `INTERNAL_` | 未分类服务端错误 |

M0 关键错误：

- `VALIDATION_INVALID`
- `AUTH_CODE_INVALID`
- `AUTH_RATE_LIMITED`
- `AUTH_EMAIL_TAKEN`
- `AUTH_PASSWORD_WEAK`
- `AUTH_LOGIN_FAILED`
- `AUTH_SESSION_INVALID`
- `AUTH_CSRF_INVALID`
- `AUTH_ORIGIN_INVALID`
- `MODEL_KEY_INVALID`
- `MODEL_CONNECTION_FAILED`
- `MODEL_RATE_LIMITED`
- `MODEL_TIMEOUT`
- `MODEL_PROVIDER_ERROR`
- `BIBLE_NOT_READY`
- `BIBLE_LOCKED`
- `BIBLE_NOT_LOCKED`
- `JOB_BUDGET_EXCEEDED`
- `JOB_CANCELLED`
- `FACT_DECISION_REQUIRED`
- `FACT_SUBMISSION_BLOCKED`
- `CANON_CHAPTER_NOT_APPROVED`
- `IMPORT_CONFLICT_UNRESOLVED`
- `VERSION_CONFLICT`
- `FORBIDDEN_TENANT_ACCESS`

## 5. M0 API Surface

下面的路由是 M0 必须实现的最小面；完整 V1 路由仍以技术设计为准。

### 5.1 认证与账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/auth/register/send-code` | 发送注册邮箱验证码 |
| POST | `/api/v1/auth/register` | 邮箱、验证码、密码、显示名注册 |
| POST | `/api/v1/auth/login` | 邮箱密码登录 |
| POST | `/api/v1/auth/logout` | 撤销当前会话 |
| GET | `/api/v1/auth/csrf` | 获取 CSRF token |
| GET | `/api/v1/auth/me` | 当前账号和会话 |

### 5.2 模型配置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/model-configs/providers` | 返回 M0 白名单 Provider |
| GET | `/api/v1/model-configs` | 当前用户配置，Key 只返回掩码 |
| POST | `/api/v1/model-configs` | 新增 DeepSeek 官方配置 |
| PATCH | `/api/v1/model-configs/:configId` | 修改非敏感字段或替换 Key |
| DELETE | `/api/v1/model-configs/:configId` | 删除配置 |
| POST | `/api/v1/model-configs/:configId/test` | 连接测试 |

### 5.3 作品与入口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/works` | 作者作品列表 |
| POST | `/api/v1/works` | 从想法/空白/模板/设定导入/旧稿导入创建作品 |
| GET | `/api/v1/works/:workId` | 作品总览 |
| GET | `/api/v1/works/:workId/branches` | M0 返回 main 分支 |
| POST | `/api/v1/works/:workId/import` | 设定导入或旧稿导入 |
| POST | `/api/v1/imports` | 从粘贴文本或小型 TXT/Markdown 文件识别设定候选，不创建作品 |
| GET | `/api/v1/imports/:importId` | 导入状态和候选 |
| GET | `/api/v1/imports/:importId/report` | 导入报告和冲突 |
| POST | `/api/v1/imports/:importId/conflicts/:conflictId/decision` | 记录导入冲突裁决 |
| POST | `/api/v1/imports/:importId/confirm` | 冲突全部裁决后创建新作品和 main 分支 |
| POST | `/api/v1/imports/manuscripts` | 从小型 TXT/Markdown 旧稿识别章节切分，不创建作品 |
| GET | `/api/v1/imports/manuscripts/:importId` | 旧稿章节切分预览 |
| POST | `/api/v1/imports/manuscripts/:importId/confirm` | 确认调整后的章节，创建新作品、main 分支和有序章节版本 |

### 5.4 故事圣经与最小设定

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/works/:workId/branches/:branchId/story-bible` | 九卡故事圣经 |
| POST | `/api/v1/works/:workId/branches/:branchId/story-bible/generate` | 生成提案 |
| PATCH | `/api/v1/works/:workId/branches/:branchId/story-bible` | 修改未锁定卡片 |
| POST | `/api/v1/works/:workId/branches/:branchId/story-bible/lock` | 锁定并创建版本节点 |
| POST | `/api/v1/works/:workId/branches/:branchId/story-bible/unlock` | 显式解锁并创建审计版本节点 |
| GET | `/api/v1/works/:workId/branches/:branchId/story-bible/versions` | 不可变版本历史 |
| GET | `/api/v1/works/:workId/branches/:branchId/story-bible/world-rules` | 查询结构化世界铁律 |
| POST | `/api/v1/works/:workId/branches/:branchId/story-bible/change-requests` | 为锁定内容创建修改请求 |
| GET | `/api/v1/works/:workId/branches/:branchId/story-bible/readiness` | 生成准备度 |
| DELETE | `/api/v1/works/:workId/branches/:branchId/story-bible/cards/:cardKey` | 固定九卡不可直接删除；锁定后返回 `BIBLE_LOCKED` |
| GET/POST | `/api/v1/works/:workId/branches/:branchId/entities` | 最小世界/人物/金手指实体 |
| GET/PATCH | `/api/v1/works/:workId/branches/:branchId/entities/:entityId` | 实体详情 |
| GET | `/api/v1/works/:workId/branches/:branchId/facts` | 已确认设定投影 |

### 5.5 章节与生成

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/works/:workId/branches/:branchId/chapters` | 章节列表/创建章纲 |
| GET/PATCH | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId` | 章节与章纲 |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/generate` | 创建单章生成 Job |
| GET | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/context-preview` | 本章参考与来源 |
| GET/POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions` | 章节版本 |

### 5.6 Job 与事件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/works/:workId/branches/:branchId/jobs/:jobId` | 任务状态和检查点 |
| GET | `/api/v1/works/:workId/branches/:branchId/jobs/:jobId/events` | SSE 事件 |
| POST | `/api/v1/works/:workId/branches/:branchId/jobs/:jobId/cancel` | 取消任务 |

### 5.7 审核、事实与故事事实提交

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/extract-facts` | 抽取事实提案 |
| GET | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/fact-proposals` | 事实提案 |
| POST | `/api/v1/works/:workId/branches/:branchId/fact-proposals/:factId/decision` | 确认/修改确认/驳回 |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/review` | 批准或驳回章节 |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/canon/commit` | 提交本章事实 |
| GET | `/api/v1/works/:workId/branches/:branchId/canon/commits` | 提交记录 |

## 6. M0 Resource Shapes

以下是字段语义冻结；具体 Zod schema 在实现时落到 `packages/contracts`。

### User / Session

- User：`id`、`emailMasked`、`displayName`、`createdAt`。
- Session：`id`、`expiresAt`、`current`、`userAgent`、`createdAt`。
- 响应不返回密码哈希、验证码、Key 明文。

### ModelConfig

- `id`、`provider`、`label`、`baseUrl`、`model`、`keyMasked`、`isDefault`、`lastTestStatus`、`lastTestedAt`。
- `provider` 在 M0 只允许 `deepseek` 和显式白名单值。
- `baseUrl` 必须是 HTTPS；禁止回环、私网、链路本地和重定向。

### Work / Branch

- Work：`id`、`title`、`penName`、`genre`、`status`、`scaleTarget`、`chapterLengthTarget`、`createdAt`、`updatedAt`。
- Branch：`id`、`workId`、`name`、`headNodeId`、`status`。
- M0 每部作品至少有 `main` 分支。

### StoryBible

- `id`、`workId`、`branchId`、`version`、`status`、`cards`、`readiness`、`proposal`、`lockedAt`、`lockedBy`。
- `cards` 固定九张：一句话故事、核心卖点、主角、金手指、世界铁律、主线、支线、结局方向、读者承诺。
- `status`：`draft`、`proposed`、`locked`。
- `readiness`：`not_ready`、`partial`、`ready`，并返回完成数、缺失卡片、结构冲突和是否可锁定。
- `worldLaws` 卡片输出结构化世界铁律：`id`、`name`、`constraint`、`scope`、`exceptions`；锁定前置校验要求至少一条规则且规则名称不得冲突。
- 每次生成提案、卡片编辑、锁定和解锁都创建 `story_bible_version` 版本节点与不可变快照；编辑与解锁必须记录原因。
- 锁定后的直接写操作返回 `BIBLE_LOCKED`；修改请求先记录旧值、新值、标题、原因和中等风险，等待后续影响分析。
- `versions` 与 `world-rules` 使用 `cursor`/`limit` 列表分页并返回 `meta.nextCursor`；修改请求创建支持 `Idempotency-Key`。
- `lockedBy` 为锁定操作者的用户 ID；锁定时间同时写入故事圣经、版本快照和版本节点。
- M0 故事圣经仅对仙侠作品开放生成、编辑和锁定；其他题材读取空九卡，写操作返回 `VALIDATION_INVALID`。

### Chapter

- `id`、`workId`、`branchId`、`number`、`title`、`status`、`version`、`brief`、`wordCount`。
- Chapter status：`planned`、`writing`、`waiting_review`、`changes_requested`、`approved`、`locked`、`published`、`rejected`。

### ManuscriptImport

- `id`、`status`、`sourceName`、`format`、`chapters`、`warnings`、`canConfirm`、`confirmedWorkId`、`createdAt`。
- `status`：`ready`、`partial`、`empty`；编码无法解析或文件类型不支持返回 `VALIDATION_INVALID`。
- `chapters` 为按原文顺序排列的 `order`、`title`、`content`、`wordCount`；默认文本导入不创建候选或已确认设定。
- 确认请求提交调整后的 `title` 和 `content` 序列；服务端必须验证这些内容按顺序拼接后与原文完全一致。

### FactProposal / Fact

- FactProposal：`id`、`chapterId`、`subject`、`predicate`、`object`、`sourceSentence`、`status`、`confidence`、`risk`。
- FactProposal status：`proposed`、`confirmed`、`modified_confirmed`、`rejected`、`superseded`。
- Confirmed Fact：`id`、`sourceChapterId`、`sourceDecisionId`、`validFromChapter`、`validToChapter`、`status`。
- 事实提案没有 `canonCommitted` 状态；提交结果由 Canon commit 和版本节点表达。

### Job

- `id`、`type`、`workId`、`branchId`、`chapterId`、`status`、`progress`、`currentStep`、`checkpoint`、`cost`、`errorCode`、`createdAt`、`startedAt`、`finishedAt`。
- Job status：`queued`、`preparing`、`running`、`paused`、`waiting_review`、`completed`、`failed`、`cancelled`。

### ContextPack

- `id`、`compilerVersion`、`tokenBudget`、`selected`、`evicted`、`sourceRefs`、`createdAt`。
- `selected` 必须保留来源引用；`evicted` 必须记录原因。

## 7. State Machines and Invariants

### 章节

```text
planned -> writing -> waiting_review -> approved -> locked -> published
                         |                  |
                         v                  v
                  changes_requested      rejected
```

- M0 允许 `approved` 后进入 `locked`；不允许从 `planned` 直接进入 `approved`。
- 章节批准只改变章节状态，不写故事事实。

### 事实与提交

```text
proposed -> confirmed
proposed -> modified_confirmed
proposed -> rejected
proposed -> superseded
```

- 事实确认只改变提案状态。
- 提交本章事实必须满足：
  - 章节状态为 `approved` 或 `locked`；
  - 所有 required 事实为 `confirmed` 或 `modified_confirmed`；
  - 没有未解决高风险冲突；
  - 操作者是作品作者。
- 提交成功创建 canon commit/version node，并更新已确认设定投影。
- 事实提交失败不得改变章节状态或提案状态。

### 版本

- 故事圣经锁定、章节版本、canon commit 和回滚都创建 `version_nodes`；故事圣经节点类型为 `story_bible_version`。
- 每个分支只有一个 head；同一分支无环。
- M0 不允许覆盖历史版本。

## 8. M0 Data Tables

M0 至少需要：

- `users`
- `sessions`
- `email_verification_codes`
- `model_configs`
- `works`
- `work_branches`
- `version_nodes`
- `story_bibles`
- `story_bible_versions`
- `entities`
- `facts`
- `chapters`
- `chapter_versions`
- `fact_proposals`
- `fact_decisions`
- `review_decisions`
- `canon_commits`
- `jobs`
- `agent_runs`
- `context_pack_versions`
- `import_jobs`
- `import_candidates`
- `import_conflicts`
- `import_reports`

所有作品域表必须有 `work_id` 和 `user_id`（或可通过 work 可靠推导的租户键）；数据库启用 RLS，并至少有一个跨用户访问测试。

## 9. Worker Job Contract

```json
{
  "jobId": "uuid",
  "jobType": "generate_chapter",
  "workId": "uuid",
  "branchId": "uuid",
  "chapterId": "uuid",
  "actorId": "uuid",
  "modelConfigId": "uuid",
  "idempotencyKey": "string",
  "budget": {
    "maxCostCny": 2.5,
    "maxTokens": 30000,
    "maxRevisionRounds": 2
  },
  "checkpoint": {
    "step": "string",
    "payload": {}
  }
}
```

- `generate_chapter` 步骤固定：prepare、compile_context、draft、verify、revise、extract_facts、await_review。
- 重试从 `checkpoint.step` 继续，不重写已完成步骤。
- 预算耗尽返回 `JOB_BUDGET_EXCEEDED` 并保留检查点。
- 取消停在当前步骤，已完成章节和草稿保留。
- Worker 不直接接受用户输入以外的任意工具调用；工具白名单由 Agent Runtime 强制。

## 10. UI Parity Gate

M0 页面必须引用原型合同中的页面/动作/状态行，并在 `docs/ui/v1-ui-parity-matrix.md` 中登记 UI ticket、parity test 和生产 golden。

### 页面范围

- auth
- dashboard
- new-project
- account-settings
- work-overview
- bible
- settings
- outline/chapter brief
- writing

### 合并门禁

每个 UI PR 必须包含：

- 页面路由映射。
- 原型页面/动作/状态矩阵引用。
- 1440/1180/900/390 的 Playwright 结构断言。
- 固定 fixture 下的生产截图，并与已签收生产基线比对。
- 作者语言扫描，不允许内部术语。
- 空、加载、错误、禁用、锁定、冲突等适用状态。

### 一致性口径

- 页面结构、组件层级、信息顺序、主操作位置、关键门禁、状态出口和响应式断点必须一致。
- 允许浏览器字体渲染造成的微小差异；生产视觉基线使用 Chromium + 固定字体环境。
- 任何视觉或交互偏离必须先更新原型、合同和签收记录，再改生产代码。
- M0 第一版页面经作者对照原型确认后，生产截图成为该页面的 golden baseline；之后 CI 不允许无审批漂移。

## 11. Change Control

- 协议字段、状态枚举、URL 或错误码变更：更新本文档和 `packages/contracts`，并通知 Web/API/Worker。
- 产品状态机或高风险门禁变更：新增 ADR。
- UI 页面/动作/状态变更：先改原型和 `docs/ui/prototype-contract.md`，重新签收后再改生产。
- 任何“实现时先凑合”的临时字段必须登记为 stub，禁止进入发布验收。
