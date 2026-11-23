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
| `BATCH_` | 批量计划、工作项和计划幂等 |
| `NOTIFICATION_` | 站内通知读取和权限 |
| `FACT_` | 事实决策和提交门禁 |
| `CANON_` | 故事事实提交和版本节点 |
| `IMPORT_` | 设定导入、旧稿导入和冲突 |
| `GENRE_` | 题材包版本、幂等和跨题材冲突 |
| `PUBLISH_` | 发布检查、固定预览和发布导出门禁 |
| `RATE_LIMIT_` | 接口限流 |
| `INTERNAL_` | 未分类服务端错误 |

M0 关键错误：

- `VALIDATION_INVALID`
- `GENRE_PACK_VERSION_NOT_FOUND`
- `GENRE_PACK_IDEMPOTENCY_CONFLICT`
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
- `BATCH_PLAN_NOT_FOUND`
- `BATCH_PLAN_INVALID`
- `BATCH_PLAN_OUTLINE_INCOMPLETE`
- `BATCH_PLAN_IDEMPOTENCY_CONFLICT`
- `BATCH_REVIEW_CONTEXT_NOT_FOUND`
- `BATCH_REVIEW_CLAIM_CONFLICT`
- `BATCH_REVIEW_IDEMPOTENCY_CONFLICT`
- `NOTIFICATION_NOT_FOUND`
- `CHANGE_NOT_FOUND`
- `CHANGE_HIGH_RISK_CONFIRMATION_REQUIRED`
- `BRANCH_SOURCE_NOT_FOUND`
- `IMPORT_NOT_READY`
- `FACT_DECISION_REQUIRED`
- `FACT_SUBMISSION_BLOCKED`
- `CANON_CHAPTER_NOT_APPROVED`
- `IMPORT_CONFLICT_UNRESOLVED`
- `WORK_IDEMPOTENCY_CONFLICT`
- `VERSION_CONFLICT`
- `FORBIDDEN_TENANT_ACCESS`
- `ACCOUNT_EXPORT_EXPIRED`
- `ACCOUNT_EXPORT_STALE`
- `ACCOUNT_DELETION_NOT_FOUND`
- `ACCOUNT_DELETION_RECOVERY_EXPIRED`
- `ACCOUNT_DELETION_INVALID_STATE`
- `PUBLISH_EXPORT_NOT_READY`
- `PUBLISH_EXPORT_EXPIRED`
- `PUBLISH_PREVIEW_NOT_FOUND`
- `PUBLISH_IDEMPOTENCY_CONFLICT`

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
| POST | `/api/v1/users/me/export` | 创建版本化、带 checksum 的账号导出 receipt |
| GET | `/api/v1/users/me/export/:receiptId/download` | 下载当前账号拥有的导出包 |
| POST | `/api/v1/users/me/delete` | 凭有效导出 receipt 进入 30 天注销恢复期 |
| GET | `/api/v1/users/me/deletion` | 当前注销/恢复/失败状态 |
| POST | `/api/v1/users/me/deletion/recover` | 在恢复截止时间前恢复账号 |

账号状态枚举固定为 `active`、`disabled`、`deletion_pending`。`deletion_pending` 仍可使用邮箱密码登录以跨设备恢复，但只允许访问身份、注销状态和恢复入口；其他业务 API 返回 `FORBIDDEN_TENANT_ACCESS`。

账号级 Worker job 固定为 `account_purge` 与 `account_purge_tick`。两者显式使用 `workId: null`、`branchId: null`、`idempotencyKey` 和版本化 checkpoint；账号级清理不得伪造作品或分支 ID。

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
| PATCH | `/api/v1/works/:workId` | 更新作品 metadata、标签、封面引用和连载状态 |
| POST | `/api/v1/works/:workId/archive` | 可逆归档作品，保留分支与版本数据 |
| POST | `/api/v1/works/:workId/restore` | 恢复归档前状态 |
| POST | `/api/v1/works/:workId/duplicate` | 幂等复制作品设定内容，正文与版本默认排除 |
| GET | `/api/v1/works/:workId/branches` | M0 返回 main 分支 |
| POST | `/api/v1/works/:workId/import` | 设定导入或旧稿导入 |
| POST | `/api/v1/imports` | 从粘贴文本或小型 TXT/Markdown/DOCX 文件识别设定候选，不创建作品 |
| GET | `/api/v1/imports/:importId` | 导入状态和候选 |
| GET | `/api/v1/imports/:importId/report` | 导入报告和冲突 |
| POST | `/api/v1/imports/:importId/conflicts/:conflictId/decision` | 记录导入冲突裁决 |
| POST | `/api/v1/imports/:importId/confirm` | 冲突全部裁决后创建新作品和 main 分支 |
| POST | `/api/v1/imports/manuscripts` | 从小型 TXT/Markdown/DOCX 旧稿识别章节切分，不创建作品 |
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
| GET/POST | `/api/v1/works/:workId/branches/:branchId/characters` | 人物专用档案列表与创建 |
| GET/PATCH | `/api/v1/works/:workId/branches/:branchId/characters/:characterId` | 人物专用档案与版本化写入 |
| POST | `/api/v1/works/:workId/branches/:branchId/characters/:characterId/knowledge-states` | 记录角色认知，区分客观事实引用与主观状态，并携带章节有效期 |
| GET | `/api/v1/works/:workId/branches/:branchId/characters/:characterId/references` | 游标分页的正文、章纲、伏笔、故事圣经与事实反向引用 |
| GET | `/api/v1/works/:workId/branches/:branchId/facts` | 已确认设定投影 |
| GET | `/api/v1/genre-packs` | 可用题材包及版本化规则/UI hints |
| POST | `/api/v1/works/:workId/genre-pack/version` | 幂等升级/回滚作品题材包版本 |

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
| POST | `/api/v1/works/:workId/branches/:branchId/batch-plans` | 幂等创建按章/卷/区间/全本批量计划 |
| GET | `/api/v1/works/:workId/branches/:branchId/batch-plans` | 按状态分页发现批量计划 |
| GET | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId` | 批量计划摘要、计数和调度策略 |
| GET | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/items` | 分页检查工作项，不返回章节正文 |
| POST | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/start` | 开始或幂等重放批量执行 |
| POST | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/pause` | 在当前步骤结束后暂停 |
| POST | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/resume` | 从暂停工作项和子任务检查点恢复 |
| POST | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/cancel` | 取消剩余工作，保留已完成/待审核章节 |
| POST | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/retry` | 从失败步骤重试失败章节 |
| GET | `/api/v1/works/:workId/branches/:branchId/review-queue` | 分页读取章节/卷审核队列 |
| POST | `/api/v1/works/:workId/branches/:branchId/review-queue/claim` | 领取一个或一批审核项 |
| POST | `/api/v1/works/:workId/branches/:branchId/review-queue/decisions` | 幂等提交逐项批准/驳回并返回部分失败 |
| GET | `/api/v1/works/:workId/branches/:branchId/batch-plans/:planId/cost-report` | 按卷/章/模型/日期聚合成本、吞吐和硬停报告 |

### 5.7 审核、事实与故事事实提交

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/extract-facts` | 抽取事实提案 |
| GET | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/fact-proposals` | 事实提案 |
| POST | `/api/v1/works/:workId/branches/:branchId/fact-proposals/:factId/decision` | 确认/修改确认/驳回 |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/review` | 批准或驳回章节 |
| POST | `/api/v1/works/:workId/branches/:branchId/chapters/:chapterId/canon/commit` | 提交本章事实 |
| GET | `/api/v1/works/:workId/branches/:branchId/canon/commits` | 提交记录 |

### 5.8 站内通知

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/notifications` | 当前用户通知；支持 `unreadOnly`、`cursor`、`limit` |
| PATCH | `/api/v1/notifications/:notificationId/read` | 标记当前用户的一条通知为已读 |
| POST | `/api/v1/notifications/read-all` | 标记当前用户全部未读通知 |

通知接口必须按当前用户隔离。写操作还须通过 Origin 和 CSRF 校验；跨用户通知统一返回 `NOTIFICATION_NOT_FOUND`，不得泄露目标是否存在。

### 5.9 修改、平行版本与搜索

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/works/:workId/branches/:branchId/changes` | 修改请求列表/创建 |
| POST | `/api/v1/works/:workId/branches/:branchId/changes/:changeId/analyze` | 生成影响分析 |
| POST | `/api/v1/works/:workId/branches/:branchId/changes/:changeId/apply` | 校验目标版本并写回对象，创建版本节点 |
| POST | `/api/v1/works/:workId/branches/:branchId/rollback` | 以新 rollback 节点恢复目标版本 |
| POST | `/api/v1/works/:workId/branches` | 从版本节点创建平行版本 |
| GET | `/api/v1/works/:workId/branches/:branchId/compare/:sourceBranchId` | 逐对象比较 |
| POST | `/api/v1/works/:workId/branches/:branchId/merge-items/:itemId/decision` | 接受/拒绝单个对象 |
| POST | `/api/v1/works/:workId/branches/:branchId/merge-items/apply` | 校验目标 head 后应用已接受的摘取项 |
| GET | `/api/v1/works/:workId/branches/:branchId/search` | 中文派生索引搜索 |
| GET | `/api/v1/search` | 当前用户全部作品主线中文搜索 |
| POST | `/api/v1/works/:workId/branches/:branchId/search/rebuild` | 创建并执行当前分支索引重建 |
| GET | `/api/v1/works/:workId/branches/:branchId/search/rebuilds/:runId` | 查询可恢复索引重建进度 |
| POST | `/api/v1/works/:workId/branches/:branchId/search/rebuilds/:runId/process` | 从检查点继续下一批索引 |

修改创建必须记录目标对象版本，修改应用同时校验请求版本与目标版本；事实应用、摘取和回滚必须转交事实决策/正史提交状态机，不能由通用修改接口直接改写。分支创建和摘取必须经过租户校验并写审计；高风险操作必须二次确认。摘取只处理逐对象决策，不允许整分支静默覆盖。

### 5.10 分块导入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/imports/manuscripts/chunked` | 创建带检查点的分块导入 |
| POST | `/api/v1/imports/manuscripts/chunked/start` | 创建流式分块导入任务 |
| POST | `/api/v1/imports/manuscripts/:importId/chunks` | 按序号追加单个分块 |
| POST | `/api/v1/imports/manuscripts/:importId/process` | 幂等投递后台分块处理 tick |
| GET | `/api/v1/imports/manuscripts/:importId/progress` | 查询分块进度 |
| POST | `/api/v1/imports/manuscripts/:importId/pause` | 暂停分块处理 |
| POST | `/api/v1/imports/manuscripts/:importId/resume` | 从已提交分块继续 |
| POST | `/api/v1/imports/manuscripts/:importId/cancel` | 取消尚未处理的分块 |
| POST | `/api/v1/imports/manuscripts/:importId/confirm-chunked` | 用章节标题和 source range 确认分块导入，不在单次请求中回传全文 |

未完成全部分块时确认导入返回 `IMPORT_NOT_READY`。分块进度同时返回 `uploadedChunks` 和
`processedChunks`；分块预览只返回章节标题、字数和 `sourceRange`，正文保留在服务端。
导入默认只保留原文，不自动写入语义候选或已确认设定。

`process_import` 是导入专用 Worker job，显式使用 `workId: null`、`branchId: null`、
幂等键和版本化 checkpoint。Worker 每次 tick 只处理有界数量的连续分块；PostgreSQL 的
`nextProcessSequence` 是恢复真源，维护 tick 会以受 RLS policy 限制的
`app.system_role = 'import_recovery'` 扫描并重新投递 Redis 丢失但仍可恢复的导入任务。

### 5.11 健康、就绪与运维指标

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/health` | API 进程 liveness，不访问依赖 |
| GET | `/api/v1/health/ready` | 检查数据库、队列，并在配置对象存储时检查 storage |
| GET | `/api/v1/metrics` | Prometheus 文本指标，不进入 OpenAPI，也不经公开 Web 代理暴露 |

`DependencyCheck.name` 固定为 `database`、`queue`、`storage`，状态固定为 `up`、`down`。Metrics 标签只允许已登记的路由模板、任务类型、状态、依赖和队列状态；正文、Prompt、ContextPack、密钥和租户原始标识不得进入标签。

### 5.12 导出格式与版本清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/works/:workId/branches/:branchId/exports` | 幂等创建 TXT/Markdown/DOCX/EPUB 导出 job |
| GET | `/api/v1/works/:workId/branches/:branchId/exports` | 调出导出历史 |
| GET | `/api/v1/works/:workId/branches/:branchId/exports/:exportId` | 导出 receipt、manifest 和状态 |
| GET | `/api/v1/works/:workId/branches/:branchId/exports/:exportId/download` | 下载已完成导出 |

导出范围固定为 `current_chapter`、`selected_chapters`、`chapter_range`、`volume`、`book`。`sourceVersionNodeId` 可选，非空时必须属于当前 branch；导出 receipt 固定精确 chapter version/version node、章节标题版本和附录版本，worker 在源 hash 变化时 fail closed。导出文件默认保留 7 天，artifact 存在 MinIO/S3 兼容对象存储；过期先删除对象，再清空 receipt 对象键和包含正文片段的 source descriptor，manifest 与审计记录保留。

manifest `schemaVersion` 为 2 时固定 `aiDisclosureMetadata`：`required` 来自作品级 AI 标识要求，`label` 为作者可读说明，`policyVersion` 固定为 `ai-disclosure-v1`。TXT/Markdown/DOCX/EPUB 的正文、版本清单和发布文案必须保留同一标识；重新导出继续从作品级要求生成，不能因格式或导出次数丢失。旧 `schemaVersion` 1 manifest 仍可读取和下载，但缺少当前 AI 标识元数据时发布检查 fail closed，要求重新导出。

本节契约变更由 Issue #129 的已批准验收范围授权，实施与验证证据记录在 `docs/implementation/m3-01a-work-export.md`。

### 5.13 发布检查与固定预览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/works/:workId/branches/:branchId/publish-check` | 从 completed、未过期的导出创建固定发布预览 |
| GET | `/api/v1/works/:workId/branches/:branchId/publish-check` | 按 `cursor`/`limit` 返回发布预览历史与 `meta.nextCursor` |
| GET | `/api/v1/works/:workId/branches/:branchId/publish-check/:previewId` | 读取指定固定预览并计算是否已过期 |

创建请求必须携带 `Idempotency-Key`。同一用户、同一 path、同一 key、同一请求体在 24 小时内返回同一预览；相同 key 携带不同请求返回 `409 PUBLISH_IDEMPOTENCY_CONFLICT`。预览固定 export receipt、manifest hash、请求/解析版本、目录、前 3 章读者预览、检查证据与发布文案；blocking 检查阻止 `publishReady`，warning 保持可见但不阻止作者继续处理。

本节契约变更由 Issue #130 的已批准验收范围授权，实施与验证证据记录在 `docs/implementation/m3-02a-publish-preview.md`。

### 5.14 内容安全与申诉

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/works/:workId/branches/:branchId/moderation-cases` | 按 `cursor`/`limit` 返回内容安全记录、证据与申诉事件 |
| POST | `/api/v1/works/:workId/branches/:branchId/moderation-cases/:caseId/appeals` | 作者提交申诉或纠正说明 |
| POST | `/api/v1/works/:workId/branches/:branchId/moderation-cases/:caseId/appeals/:appealId/withdraw` | 作者撤回当前申诉 |

发布预览创建时，服务从 `content_safety_review` 检查结果生成不可重复的 `moderation_cases` 记录。记录固定 `ruleVersion`、全部命中的本地提示、涉及章节编号和当前状态 `clear`、`needs_review`、`appeal_submitted`。申诉提交必须带 `Idempotency-Key`；同一 key 与请求体返回首次提交时的固定案件快照，不同请求返回 `409 MODERATION_APPEAL_IDEMPOTENCY_CONFLICT`。提交和撤回都写入 append-only `moderation_events`，事件带对应 `appealId`；单案最多 20 次申诉。作者、作品、创作线不匹配返回 `FORBIDDEN_TENANT_ACCESS`。

内容安全使用本地规则提示，不按关键词自动封禁。申诉是作者可见的复核/纠正入口，不等同于平台或监管最终审核结论。

本节契约变更由 Issue #131 的已批准验收范围授权，实施与验证证据记录在 `docs/implementation/m3-02b-help-legal-moderation.md`。

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

- Work：`id`、`title`、`penName`、`genre`、`status`、`scaleTarget`、`chapterLengthTarget`、`settings`、`coverImageUrl`、`tags`、`version`、`archivedAt`、`deletedAt`、`purgeAfter`、`createdAt`、`updatedAt`。
- Branch：`id`、`workId`、`name`、`headNodeId`、`status`。
- M0 每部作品至少有 `main` 分支。

### Work Settings Lifecycle

- `PATCH /api/v1/works/:workId` 请求体必须包含当前 `version`，可更新 `title`、`penName`、`genre`、`status`、`scaleTarget`、`chapterLengthTarget`、`coverImageUrl`、`tags` 和 `settings`。成功响应为最新 `WorkOverview`，`version` 加一。
- 可编辑状态只接受 `preparing`、`serializing`、`paused` 和 `completed`。`archive` 和 `restore` 通过独立端点改变 `archived` 状态，不能借 PATCH 绕过。
- `coverImageUrl` 为空或 HTTPS URL；`tags` 最多 20 个、每个 1–30 个字符且不得重复。API 和 PostgreSQL 都必须拒绝不合法值。
- `POST archive` 与 `POST restore` 请求体均为 `{ "version": number }`。版本不匹配返回 `409 VERSION_CONFLICT`。归档保留 branch、版本节点、故事圣经、设定和大纲；恢复回到归档前状态。
- `POST /api/v1/works/:workId/trash` 将作品软删除并写入 30 天 `purgeAfter`；`GET /api/v1/works?trash=true` 只返回当前用户的回收站作品；`POST /api/v1/works/:workId/trash/restore` 在保留期内恢复作品。
- `POST /api/v1/works/:workId/purge` 只在保留期结束且存在未过期的已完成作品导出时永久删除作品。正文、分支、版本、正史、对象和导出引用按外键级联清理；清理任务只自动处理已满足导出门禁的作品。
- `PUT /api/v1/works/:workId/cover?version=number` 接受 JPEG、PNG 或 WebP multipart 文件，重新编码为 WebP 后写入对象存储；`GET /api/v1/works/:workId/cover` 通过作者会话私有读取封面。
- `POST /api/v1/works/:workId/duplicate` 必须带 `Idempotency-Key`，请求体为 `{ title?, copyManuscript?, copyHistory? }`。`copyManuscript` 和 `copyHistory` 默认均为 `false`，选择历史时必须同时选择正文。成功响应为新的独立 `WorkOverview`。
- duplicate 默认复制作品 metadata/settings、故事圣经、可独立存在的设定与账本、大纲，以及 `settings.styleSample` 中的作者风格样本。`style_profiles`/`style_baselines` 只有在其来源、样本和版本引用都不依赖章节/章节版本时才可复制；当前 chapter-bound profile、golden-three baseline 和候选一律不复制。
- duplicate 明确排除正文、`chapters`、`chapter_versions`、章节派生事实、事实决策、canon commit、人物认知状态、黄金三章候选/评审/锁定，以及依赖章节版本的风格档案。这些内容必须在新作品中重新生成或重新确认。
- 所有被复制对象必须生成新 ID。实体、地图、时间线、大纲、账本、场景引用，以及账本 `history` 中嵌套的 `chapter.id`、`event.eventId` 等 ID 必须重映射；不可独立重建的章节引用必须清空，不能保留源作品 ID。默认不复制正文与版本章节；`copyManuscript`/`copyHistory` 仅为显式作者 opt-in。
- duplicate 的幂等 scope 固定为当前用户、`work.duplicate:<sourceWorkId>` 和 key，有效期 24 小时。同一 key 与同一请求返回同一作品；同一 key 与不同请求返回 `409 WORK_IDEMPOTENCY_CONFLICT`。
- 所有 Work mutation 都校验租户归属。跨用户读取或写入返回 `403 FORBIDDEN_TENANT_ACCESS`，并由 RLS 在数据库层再次拒绝。

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
- 仙侠、历史、都市作品均可生成、编辑和锁定故事圣经；题材包规则禁止的术语在作者编辑或修改请求中返回 `VALIDATION_INVALID`。

### Chapter

- `id`、`workId`、`branchId`、`number`、`title`、`status`、`version`、`brief`、`wordCount`。
- Chapter status：`planned`、`writing`、`waiting_review`、`changes_requested`、`approved`、`locked`、`published`、`rejected`。

### ManuscriptImport

- `id`、`status`、`sourceName`、`format`（`txt`、`markdown`、`docx`）、`chapters`、`warnings`、`canConfirm`、`confirmedWorkId`、`createdAt`。
- `status`：`ready`、`partial`、`empty`；编码无法解析、文件类型不支持或 DOCX 包结构无效返回 `VALIDATION_INVALID`。
- `chapters` 为按原文顺序排列的 `order`、`title`、`content`、`wordCount`、`sourceRange`；分块预览的 `content` 为空字符串，表示正文仍安全保留在导入任务中。默认文本导入不创建候选或已确认设定。
- 确认请求提交调整后的 `title` 和 `content` 序列；服务端必须验证这些内容按顺序拼接后与原文完全一致。

### FactProposal / Fact

- FactProposal：`id`、`chapterId`、`subject`、`predicate`、`object`、`sourceSentence`、`status`、`confidence`、`risk`。
- FactProposal status：`proposed`、`confirmed`、`modified_confirmed`、`rejected`、`superseded`。
- Confirmed Fact：`id`、`sourceChapterId`、`sourceDecisionId`、`validFromChapter`、`validToChapter`、`status`。
- 事实提案没有 `canonCommitted` 状态；提交结果由 Canon commit 和版本节点表达。

### Job

- `id`、`type`、`workId`、`branchId`、`chapterId`、`status`、`progress`、`currentStep`、`checkpoint`、`cost`、`errorCode`、`createdAt`、`startedAt`、`finishedAt`。
- Job status：`queued`、`preparing`、`running`、`paused`、`waiting_review`、`completed`、`failed`、`cancelled`。

### BatchPlan / WorkItem

- `BatchPlan`：`id`、`jobId`、`workId`、`branchId`、`userId`、`status`、`scope`、`approvalMode`、`priorityClass`、`idempotencyKey`、`counts`、`scheduling`、`createdAt`、`updatedAt`。
- `scope`：`chapter`（章节 ID 列表）、`volume`（卷节点 ID 列表）、`range`（连续章节号）、`book`。
- `counts`：按 `book` / `volume` / `chapter` / `step` 和 `pending` / `ready` / `running` / `paused` / `waiting_review` / `succeeded` / `failed` / `skipped` / `cancelled` 聚合。
- `scheduling.caps` 固定为 `global=4`、`perWork=2`、`perUser=2`；`effectivePerWork` 是请求并发被策略上限裁剪后的值。
- `WorkItem`：`id`、`planId`、`workId`、`branchId`、`userId`、`key`、`type`、`parentKey`、`chapterId`、`outlineNodeId`、`status`、`attempt`、`priority`、`priorityClass`、`sortOrder`、`inputVersion`、`dependsOn`、`outputRefs`、`errorCode`、`errorMessage`。
- `WorkItem.status`：`pending`、`ready`、`running`、`paused`、`waiting_review`、`succeeded`、`failed`、`skipped`、`cancelled`。
- 工作项 key 稳定：`book`、`volume:<nodeId>`、`chapter:<chapterId>`、`step:<chapterId>:<stepKey>`。
- 计划创建不向队列投递数千个 job；只创建一条父任务记录和 `job_work_items` 工作项。执行、暂停、恢复、重试和失败隔离由 #152 组合 #110/#115 的原语实现。
- 执行通过小载荷 `batch_tick` 每次领取一个章节并投递单章生成子任务；子任务完成后再触发下一次 tick。暂停/取消在步骤边界生效，审核状态保持 `waiting_review`，不自动批准。

### Notification

- `id`、`userId`、`workId`、`branchId`、`type`、`targetType`、`targetId`、`payload`、`dedupeKey`、`readAt`、`createdAt`。
- `type`：`job_completed`、`job_failed`、`review_required`、`merge_completed`、`merge_conflict`。
- `targetType`：`job`、`review`、`merge`、`work`、`branch`。
- `payload`：作者可读的 `title`、`message` 和站内 `href`。
- 列表按 `createdAt DESC, id DESC` 游标分页；`meta.unreadCount` 是当前用户全部未读数，不是当前页未读数。
- `POST /notifications/read-all` 返回 `{ updated }`，表示本次实际从“未读”变为“已读”的数量。
- 批量计划和独立单章生成事件通知都在同一数据库事务内写入，去重键包含任务、事件类型和事件序号；重试后的新事件可以产生新通知，批量子任务不重复通知。

### ChangeRequest / MergeItem

- `ChangeRequest`：`id`、`workId`、`branchId`、`title`、`reason`、`targetType`、`targetId`、`objectType`、`before`、`after`、`diff`、`source`、`risk`、`status`、`version`。
- `MergeItem`：来源/目标分支、来源/目标版本节点、对象类型和 ID、源/目标载荷、差异、风险、冲突、状态、原因和版本。
- 修改应用、合并和回滚均创建不可变版本节点；分支之间共享历史节点但各自维护 head。
- 搜索文档是派生索引，包含来源、标题、内容、别名、版本节点和章节有效期。

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
- `notifications`
- `change_requests`
- `change_impacts`
- `merge_items`
- `merge_decisions`
- `import_chunks`

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
