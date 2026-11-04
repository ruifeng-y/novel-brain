# NovelBrain V1 后端技术设计

> 状态：V1 基线 v2（已同步 ADR 0010–0023）
> 版本：v0.4
> 日期：2026-11-04
> 范围：NestJS API、NestJS Worker、Drizzle 数据模型、REST API、任务状态机
> 关联文档：`docs/requirements/v1-requirements.md`、`GLOSSARY.md`、`docs/adr/0001`–`0023`、`docs/planning/v1-capability-manifest.md`

## 0. V1 Baseline Freeze

以下约束优先于本文旧条款；冲突时以 ADR 0010–0023 和 `docs/planning/v1-capability-manifest.md` 为准。

- 容量基线：1000 万字、3000–4000 章、30–40 卷；每卷 80–120 章，每章 2500–3500 字。
- 版本模型：每个分支只有一套版本图；branch commit、canon commit、章节版本、大纲版本、快照和修改请求必须挂到同一张图，不允许并存多套互相竞争的真源。
- Agent Runtime：GenerationModule 必须增加 Agent 角色、AgentRun、ToolCall、ContextPack、PromptVersion、ModelCall、EvalRun、Feedback 的运行记录；角色和权限按 ADR 0001。
- 上下文：ContextCompiler 必须支持 P0–P4、关键事实固定、模型自适应预算、来源引用、淘汰记录、摘要失效和索引重建；V1 结构化检索优先，向量检索作为后续增强。
- 审核与正史：章节批准不等于事实提交；事实逐项确认；Canon Curator 是唯一提交执行入口；高风险冲突不可绕过。
- 导入：默认文本导入只解析/切分/保留原文；可选设定提取才走候选、冲突、报告和断点恢复。
- 安全与生命周期：BYOK Provider 白名单、HTTPS/SSRF 防护、RLS、日志脱敏、追踪默认关闭或自托管、删除 SLA 覆盖备份和不可变历史。
- 规模验证：压测、索引、备份、存储、成本和恢复演练全部按 1000 万字重算；不能再用 300 万字结果代替。
- 细化裁决：单一版本图、审核状态机、导入分块、一等领域模型、选择性摘取、父子卷章任务、质量与安全门禁见 ADR 0016–0023。

## 1. 目标与约束

### 1.1 目标

- 用 TypeScript 一条语言实现 Web、API、Worker 和共享领域逻辑。
- 支撑 1000 万字、3000–4000 章以上作品，以及多作品、多分支、多用户。
- 让正史、角色认知、叙事计划、正文版本和修改记录可追溯、可回滚。
- 让长任务可暂停、恢复、取消、重试，并且能从失败步骤继续。

### 1.2 技术约束

- 后端框架：NestJS。
- ORM：Drizzle。
- 数据库：Postgres 16；pgvector 作为后续增强，V1 结构化检索优先。
- 队列：BullMQ 加 Redis。
- 任务状态和检查点：Postgres。
- 文件：本地 MinIO，云上 S3 兼容存储。
- 模型：Vercel AI SDK，首批接入 DeepSeek 官方 API，OpenAI 兼容接口。
- 追踪：Langfuse TS SDK。
- 部署：先局域网 Docker Compose，云上托管后续。
- 中文检索：V1 用 `pg_trgm` + `simple tsvector`；向量检索后续，不装 `zhparser`。
- 测试：Vitest，E2E 用 Playwright。
- 不做 Python 服务、本地模型、管理员后台、团队、配额、计费。

### 1.3 架构形态

采用模块化单体加独立 Worker，不做微服务。

```text
浏览器
  → Caddy
      → /        → Next.js
      → /api/*   → NestJS API

NestJS API
  → Postgres
  → Redis
  → S3 / MinIO

NestJS Worker
  → BullMQ
  → Postgres 任务状态和检查点
  → AI SDK
  → 云端模型
  → Langfuse
```

## 2. Monorepo 结构

```text
apps/
  web/                 Next.js 前端和 BFF
  api/                 NestJS HTTP API
  worker/              NestJS standalone Worker
packages/
  core/                框架无关的领域逻辑
  db/                  Drizzle schema、迁移、仓储
  ai/                  AI SDK、Prompt、检索、校验
  contracts/           Zod schema、环境变量校验、OpenAPI 类型、共享 DTO
infra/
  docker/              Dockerfile、Compose、Caddy
  migrations/          迁移执行脚本
  backups/             备份和恢复脚本
```

### 2.1 包职责

| 包 | 职责 | 不做什么 |
| --- | --- | --- |
| `apps/web` | 页面、编辑器、SSE 展示、前端路由 | 不承载领域业务 |
| `apps/api` | HTTP 接口、认证、DTO、OpenAPI、SSE | 不直接写模型调用逻辑 |
| `apps/worker` | BullMQ 消费、长任务执行、检查点 | 不暴露 HTTP |
| `packages/core` | 正史、规划、生成、校验、修改、导出领域逻辑 | 不依赖 NestJS |
| `packages/db` | Drizzle schema、迁移、查询构造 | 不写业务规则 |
| `packages/ai` | 模型网关、Prompt、检索、结构化输出 | 不写数据库事务 |
| `packages/contracts` | Zod、环境变量 schema、DTO、OpenAPI 类型 | 不放运行时业务 |

### 2.2 依赖规则

- `apps/api` 和 `apps/worker` 依赖 `packages/core`、`packages/db`、`packages/ai`、`packages/contracts`。
- `packages/core` 不依赖 NestJS、Next.js、BullMQ。
- `packages/db` 不依赖 `packages/core`。
- `packages/ai` 不依赖 `packages/db`，通过接口接收上下文和模型配置。
- Controller 只做参数校验、鉴权、调用应用服务。
- 领域事件通过明确的 service 接口传递，不通过全局单例互相调用。

## 3. NestJS 模块清单

### 3.1 模块总表

| 模块 | 职责 | 主要依赖 |
| --- | --- | --- |
| `AppModule` | 配置、日志、健康检查、指标 | 全局 |
| `DatabaseModule` | Drizzle 实例、事务、迁移 | Postgres |
| `AuthModule` | 验证码、注册、登录、会话、找回密码 | Users、Mail、Redis |
| `UsersModule` | 账号、笔名、资料、注销 | Database |
| `WorksModule` | 作品、分支、作品设置、复制 | Database、Jobs |
| `CanonModule` | 实体、关系、事实、认知、事件、正史提交 | Database、AI |
| `PlanningModule` | 全书、卷、幕、章、场景、剧情线、伏笔、人物弧 | Database、Canon |
| `AgentRuntimeModule` | 编排器、Agent 角色、工具白名单、权限、重试、轨迹 | Generation、Canon、AI、Jobs |
| `ContextModule` | P0–P4 上下文编译、分层摘要、检索、索引重建 | Canon、Planning、AI |
| `GenerationModule` | 章节生成、事实抽取、Critic、Reviser、校验 | AgentRuntime、Context、Canon、Planning、AI、Jobs |
| `ReviewModule` | 批注、连续性问题、质量报告 | Generation、Canon |
| `ChangesModule` | 修改请求、影响分析、版本、平行版本、回滚 | Canon、Planning、Generation |
| `ImportModule` | 文本导入、设定提取、候选、冲突、报告、断点恢复 | Works、Canon、Jobs、Storage |
| `EvalModule` | 基准集、rubric、回归、灰度、发布门禁 | Generation、Review、Ai |
| `NotificationModule` | 站内通知、审核提醒、已读、幂等 | Jobs、Review |
| `FeedbackModule` | 作者接受/拒绝/改写/候选选择/原因 | Generation、Eval |
| `ModerationModule` | 内容审核、AI 标识、申诉、规则依据 | Generation、Export |
| `JobsModule` | 任务、步骤、检查点、暂停恢复、SSE | Redis、Database |
| `AiModule` | 模型配置、网关、Prompt、结构化输出、用量 | Database、AI |
| `ExportModule` | 导出、发布检查、文件下载 | Storage、Jobs、Planning |
| `StorageModule` | S3 或 MinIO、签名链接、文件校验 | 外部存储 |
| `MailModule` | SMTP、验证码、找回密码邮件 | 外部邮件 |
| `ObservabilityModule` | 日志、追踪、指标、审计 | 全局 |
| `CommonModule` | Guard、Interceptor、Filter、分页、错误 | 全局 |

### 3.2 AuthModule

职责：

- 发送注册验证码。
- 注册、登录、退出、退出所有设备。
- 找回密码。
- 会话校验。
- 登录和验证码限流。

关键接口：

```text
POST /api/v1/auth/send-code
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/logout-all
GET  /api/v1/auth/me
POST /api/v1/auth/password/forgot
POST /api/v1/auth/password/reset
PATCH /api/v1/auth/password
```

实现要点：

- 密码用 Argon2id。
- 会话使用 opaque token，数据库存 token hash。
- Cookie 使用 httpOnly、Secure、SameSite=Lax。
- 验证码存 hash，带过期时间、尝试次数和消费时间。
- 登录、验证码、找回密码接口走 Redis 限流。

### 3.3 UsersModule

职责：

- 账号资料。
- 多笔名。
- 注销流程。
- 数据导出入口。

关键接口：

```text
GET   /api/v1/users/me
PATCH /api/v1/users/me
GET   /api/v1/users/me/pen-names
POST  /api/v1/users/me/pen-names
PATCH /api/v1/users/me/pen-names/:penNameId
DELETE /api/v1/users/me/pen-names/:penNameId
POST  /api/v1/users/me/delete
GET   /api/v1/users/me/export
```

### 3.4 WorksModule

职责：

- 作品 CRUD。
- 作品状态、归档、恢复、软删除。
- 分支创建、归档、比较、选择性摘取。
- 导入入口。
- 作品复制。

关键接口：

```text
GET    /api/v1/works
POST   /api/v1/works
GET    /api/v1/works/:workId
PATCH  /api/v1/works/:workId
DELETE /api/v1/works/:workId
POST   /api/v1/works/:workId/duplicate
POST   /api/v1/works/:workId/import
POST   /api/v1/works/:workId/archive
POST   /api/v1/works/:workId/restore

GET    /api/v1/works/:workId/branches
POST   /api/v1/works/:workId/branches
GET    /api/v1/works/:workId/branches/:branchId
PATCH  /api/v1/works/:workId/branches/:branchId
POST   /api/v1/works/:workId/branches/:branchId/archive
POST   /api/v1/works/:workId/branches/:branchId/compare
POST   /api/v1/works/:workId/branches/:branchId/cherry-pick
```

### 3.5 CanonModule

职责：

- 实体、关系、事实、认知、事件、剧情线、伏笔、人物弧。
- 正史提交、快照、回滚。
- 设定体检。
- 被引用关系。

关键接口：

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/entities
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/entities/:entityId
GET/POST   /api/v1/works/:workId/branches/:branchId/relations
GET/POST   /api/v1/works/:workId/branches/:branchId/facts
GET/POST   /api/v1/works/:workId/branches/:branchId/knowledge-states
GET/POST   /api/v1/works/:workId/branches/:branchId/events
GET/POST   /api/v1/works/:workId/branches/:branchId/threads
GET/POST   /api/v1/works/:workId/branches/:branchId/foreshadows
GET/POST   /api/v1/works/:workId/branches/:branchId/character-arcs
POST       /api/v1/works/:workId/branches/:branchId/canon/commits
GET        /api/v1/works/:workId/branches/:branchId/canon/commits
GET        /api/v1/works/:workId/branches/:branchId/canon/snapshots/:snapshotId
POST       /api/v1/works/:workId/branches/:branchId/canon/audit
GET        /api/v1/works/:workId/branches/:branchId/canon/health
```

### 3.6 PlanningModule

职责：

- 全书、卷、幕、章、场景大纲。
- 章纲、场景卡、节奏、钩子。
- 剧情线、伏笔、人物弧。
- 大纲锁定、重生成、版本。
- 生成准备度检查。

关键接口：

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/outlines
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/outlines/:outlineId
POST       /api/v1/works/:workId/branches/:branchId/outlines/:outlineId/lock
POST       /api/v1/works/:workId/branches/:branchId/outlines/:outlineId/unlock
POST       /api/v1/works/:workId/branches/:branchId/outlines/:outlineId/regenerate
GET/POST   /api/v1/works/:workId/branches/:branchId/chapters
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/chapters/:chapterId
GET/POST   /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/scenes
GET/POST   /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions
GET        /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions/:versionId
POST       /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/restore/:versionId
GET        /api/v1/works/:workId/branches/:branchId/outline/readiness
```

### 3.7 GenerationModule

职责：

- 编译上下文。
- 单章生成、续写、重写、扩写、缩写、改视角、加钩子。
- 事实抽取。
- 连续性和质量检查。
- 生成提案和草稿。
- 与 Worker 的任务对接。

关键接口：

```text
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/generate
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/continue
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/rewrite
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/expand
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/condense
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/change-pov
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/hooks
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/title
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/summary
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/extract-facts
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/verify
GET  /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/context-preview
GET  /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/annotations
PATCH /api/v1/works/:workId/branches/:branchId/annotations/:annotationId
GET  /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/quality
```

交互式单章生成可以直接走 NestJS API 并流式返回；长任务通过 `JobsModule` 进入 Worker。

### 3.8 ReviewModule

职责：

- 行内批注。
- 连续性问题。
- 质量报告。
- 低风险问题可以忽略并记录原因；高风险问题不可绕过。

### 3.9 ChangesModule

职责：

- 修改请求。
- 影响分析。
- 一致性校验。
- 版本、平行版本、回滚、选择性摘取。
- 审计记录。

关键接口：

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/changes
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/changes/:changeId
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/analyze
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/apply
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/reject
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/branch
GET        /api/v1/works/:workId/branches/:branchId/changes/:changeId/impact
GET        /api/v1/works/:workId/branches/:branchId/versions
POST       /api/v1/works/:workId/branches/:branchId/rollback
```

### 3.10 JobsModule

职责：

- 创建任务，写入 Postgres 任务表。
- 投递 BullMQ。
- 任务步骤、检查点、事件。
- 暂停、恢复、取消、重试。
- SSE 事件流。

关键接口：

```text
GET/POST /api/v1/works/:workId/branches/:branchId/jobs
GET      /api/v1/works/:workId/branches/:branchId/jobs/:jobId
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/pause
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/resume
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/cancel
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/retry
GET      /api/v1/works/:workId/branches/:branchId/jobs/:jobId/events
GET      /api/v1/works/:workId/branches/:branchId/review-queue
```

### 3.11 AiModule

职责：

- 模型配置 CRUD。
- Key 加密、掩码、测试连接。
- 模型网关、provider 适配、流式输出、结构化输出。
- Prompt 版本。
- 用量和费用记录。

关键接口：

```text
GET/POST   /api/v1/model-configs
GET/PATCH/DELETE /api/v1/model-configs/:configId
POST       /api/v1/model-configs/:configId/test
GET        /api/v1/model-configs/providers
GET        /api/v1/usage
```

### 3.12 ExportModule

职责：

- 导出任务。
- 平台预设。
- 发布检查。
- 文件下载和过期。

关键接口：

```text
GET/POST /api/v1/works/:workId/branches/:branchId/exports
GET      /api/v1/works/:workId/branches/:branchId/exports/:exportId
GET      /api/v1/works/:workId/branches/:branchId/exports/:exportId/download
GET/POST /api/v1/export-templates
POST     /api/v1/works/:workId/branches/:branchId/publish-check
```

## 4. Drizzle 数据模型

### 4.1 约定

- 主键统一用 `uuid`，默认 `gen_random_uuid()`。
- 时间统一用 `timestamptz`。
- 用户可见数据带 `deleted_at`，软删除。
- 故事数据统一带 `work_id` 和 `branch_id`。
- 状态字段用 `pgEnum` 或带检查约束的 `text`。
- 弹性字段用 `jsonb`，查询关键字段用独立列。
- 大文本先存 Postgres `text`，导出、图片和附件本地走 MinIO，云上走 S3 兼容存储。
- 章节版本存 `content` 和 `content_hash`，用于去重。
- 中文检索 V1 用 `pg_trgm` 做名称和子串匹配，`simple tsvector` 做精确词匹配，实体别名和时间过滤做扩展；不安装 `zhparser`。
- `pgvector` 和 HNSW 作为后续语义检索增强，不进入 V1 发布门禁。
- 所有表带 `created_at`，需要修改的表带 `updated_at`。

### 4.2 身份模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `users` | `id`, `email`, `password_hash`, `display_name`, `status`, `last_login_at`, `deleted_at` | 唯一 `lower(email)`；`status` |
| `pen_names` | `id`, `user_id`, `name`, `bio`, `avatar_url`, `is_default` | 唯一 `(user_id, name)` |
| `sessions` | `id`, `user_id`, `token_hash`, `user_agent`, `ip`, `expires_at`, `revoked_at`, `last_seen_at` | 唯一 `token_hash`；`user_id` |
| `email_codes` | `id`, `email`, `code_hash`, `purpose`, `expires_at`, `consumed_at`, `attempts` | `(email, purpose, created_at)` |
| `password_resets` | `id`, `user_id`, `token_hash`, `expires_at`, `consumed_at` | 唯一 `token_hash` |
| `audit_logs` | `id`, `user_id`, `action`, `target_type`, `target_id`, `metadata`, `ip`, `user_agent` | `(user_id, created_at)`；`(target_type, target_id)` |

### 4.3 作品模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `works` | `id`, `user_id`, `title`, `pen_name_id`, `genre_pack`, `target_platform`, `target_reader`, `scale`, `status`, `synopsis`, `cover_url`, `style_profile`, `taboos`, `settings`, `deleted_at` | `(user_id, status, updated_at)` |
| `work_branches` | `id`, `work_id`, `name`, `parent_branch_id`, `base_node_id`, `head_node_id`, `status`, `created_by`, `archived_at` | 唯一 `(work_id, name)`；`(work_id, status)`；`head_node_id` 指向 `version_nodes` |
| `version_nodes` | `id`, `branch_id`, `parent_node_id`, `node_type`, `object_type`, `object_id`, `object_version`, `snapshot_id`, `payload`, `actor_id`, `message`, `created_at` | `(branch_id, created_at)`；每节点唯一父节点；每分支唯一 head |
| `branch_commits` | 遗留表，迁移后作为 `version_nodes` 的视图/只读投影 | 不再作为独立父链 |
| `attachments` | `id`, `work_id`, `kind`, `storage_key`, `mime`, `size`, `checksum` | `(work_id, kind)` |

### 4.4 正史模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `entities` | `id`, `work_id`, `branch_id`, `type`, `name`, `aliases`, `summary`, `description`, `attributes`, `status`, `source`, `deleted_at` | `(work_id, branch_id, type, status)`；GIN `aliases` |
| `entity_versions` | `id`, `entity_id`, `version`, `snapshot`, `change_request_id` | 唯一 `(entity_id, version)` |
| `relations` | `id`, `work_id`, `branch_id`, `from_entity_id`, `predicate`, `to_entity_id`, `attributes`, `valid_from`, `valid_to`, `source`, `status` | `(work_id, branch_id, from_entity_id, predicate)`；`to_entity_id` |
| `facts` | `id`, `work_id`, `branch_id`, `subject_type`, `subject_id`, `predicate`, `object_type`, `object_id`, `object_value`, `modality`, `holder_id`, `valid_from`, `valid_to`, `source_chapter_id`, `confidence`, `status` | `(work_id, branch_id, subject_id, predicate)`；`holder_id`；`status` |
| `knowledge_states` | `id`, `work_id`, `branch_id`, `character_id`, `fact_id`, `state`, `valid_from`, `valid_to`, `source_chapter_id` | `(character_id, state)`；`fact_id` |
| `events` | `id`, `work_id`, `branch_id`, `type`, `title`, `description`, `participants`, `location_id`, `story_time`, `chapter_id`, `consequences`, `status` | `(work_id, branch_id, story_time)`；`chapter_id` |
| `threads` | `id`, `work_id`, `branch_id`, `type`, `name`, `summary`, `stakes`, `status`, `start_node`, `payoff_node`, `tension_curve` | `(work_id, branch_id, type, status)` |
| `foreshadows` | `id`, `work_id`, `branch_id`, `thread_id`, `clue`, `plant_chapter_id`, `payoff_chapter_id`, `status`, `importance`, `reader_promise` | `(work_id, branch_id, status, payoff_chapter_id)` |
| `character_arcs` | `id`, `work_id`, `branch_id`, `character_id`, `start_state`, `desire`, `fear`, `lie`, `truth`, `end_state`, `status` | `(work_id, branch_id, character_id)` |
| `canon_commits` | 遗留表，迁移后作为 `version_nodes` 中 `canon_commit` 节点的视图 | 不再作为独立父链 |
| `canon_snapshots` | `id`, `work_id`, `branch_id`, `commit_id`, `snapshot` | 唯一 `commit_id` |
| `canon_events` | `id`, `work_id`, `branch_id`, `event_type`, `payload`, `chapter_id` | `(work_id, branch_id, created_at)`；GIN `payload` |

### 4.5 规划模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `outlines` | `id`, `work_id`, `branch_id`, `level`, `parent_id`, `order_index`, `title`, `summary`, `content`, `status`, `locked_at` | `(work_id, branch_id, level, parent_id, order_index)` |
| `outline_versions` | `id`, `outline_id`, `version`, `snapshot`, `change_request_id` | 唯一 `(outline_id, version)` |
| `chapters` | `id`, `work_id`, `branch_id`, `outline_id`, `volume_id`, `arc_id`, `number`, `title`, `status`, `current_version_id`, `word_count`, `pov_character_id`, `location_id`, `story_time`, `summary`, `hook` | 唯一 `(work_id, branch_id, number)`；`status` |
| `chapter_versions` | `id`, `chapter_id`, `version`, `content`, `content_hash`, `word_count`, `model_config_id`, `created_by`, `source`, `change_request_id` | 唯一 `(chapter_id, version)`；`content_hash` |
| `scenes` | `id`, `chapter_id`, `order_index`, `title`, `summary`, `pov_character_id`, `location_id`, `story_time`, `beats`, `status` | `(chapter_id, order_index)` |
| `chapter_summaries` | `id`, `chapter_id`, `summary`, `arc_summary`, `volume_summary` | 唯一 `chapter_id` |

### 4.6 生成模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `generation_requests` | `id`, `work_id`, `branch_id`, `chapter_id`, `type`, `instruction`, `model_config_id`, `status`, `created_by`, `finished_at` | `(work_id, branch_id, chapter_id, status)` |
| `context_packs` | `id`, `generation_request_id`, `token_budget`, `sections`, `source_refs` | `generation_request_id` |
| `drafts` | `id`, `generation_request_id`, `chapter_id`, `content`, `status` | `generation_request_id`；`chapter_id` |
| `annotations` | `id`, `chapter_id`, `draft_id`, `start_offset`, `end_offset`, `type`, `severity`, `message`, `suggestion`, `status`, `ignored_reason` | `(chapter_id, status)` |
| `consistency_issues` | `id`, `work_id`, `branch_id`, `chapter_id`, `type`, `severity`, `message`, `suggestion`, `status`, `confidence` | `(work_id, branch_id, chapter_id, status)` |
| `quality_reports` | `id`, `chapter_id`, `scores`, `summary` | `chapter_id` |

### 4.7 修改模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `change_requests` | `id`, `work_id`, `branch_id`, `target_type`, `target_id`, `title`, `reason`, `diff`, `source`, `risk`, `status`, `created_by`, `applied_at` | `(work_id, branch_id, status, target_type)` |
| `impact_reports` | `id`, `change_request_id`, `affected`, `classification`, `confidence` | `change_request_id` |
| `validations` | `id`, `change_request_id`, `step`, `status`, `details` | `change_request_id` |
| `branch_merges` | `id`, `work_id`, `source_branch_id`, `target_branch_id`, `change_request_id`, `status`, `finished_at` | `(work_id, status)` |

### 4.8 任务模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `jobs` | `id`, `work_id`, `branch_id`, `user_id`, `type`, `status`, `priority`, `payload`, `progress`, `attempts`, `max_attempts`, `checkpoint`, `error`, `started_at`, `finished_at` | `(work_id, status, created_at)`；`user_id` |
| `job_steps` | `id`, `job_id`, `step_key`, `status`, `input`, `output`, `started_at`, `finished_at`, `error` | 唯一 `(job_id, step_key)` |
| `job_checkpoints` | `id`, `job_id`, `step_key`, `state` | `(job_id, created_at)` |
| `job_events` | `id`, `job_id`, `event_type`, `payload` | `(job_id, created_at)` |
| `usage_records` | `id`, `user_id`, `work_id`, `job_id`, `model`, `prompt_tokens`, `completion_tokens`, `cost` | `(user_id, created_at)`；`work_id` |

### 4.9 模型模块

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `model_configs` | `id`, `user_id`, `name`, `provider`, `base_url`, `encrypted_api_key`, `model`, `capabilities`, `is_default` | `user_id` |
| `prompt_versions` | `id`, `key`, `version`, `content`, `schema`, `active` | 唯一 `(key, version)` |
| `model_calls` | `id`, `user_id`, `work_id`, `job_id`, `model_config_id`, `prompt_version_id`, `request_summary`, `response_summary`, `prompt_tokens`, `completion_tokens`, `cost`, `latency_ms`, `status` | `(user_id, created_at)`；`work_id`；`job_id` |

### 4.10 导出与搜索

| 表 | 关键列 | 索引和约束 |
| --- | --- | --- |
| `export_jobs` | `id`, `work_id`, `branch_id`, `format`, `range`, `options`, `status`, `file_key`, `error`, `expires_at` | `(work_id, status)` |
| `export_templates` | `id`, `name`, `config` | 唯一 `name` |
| `search_documents` | `id`, `work_id`, `branch_id`, `source_type`, `source_id`, `title`, `content`, `tsv`, `embedding`, `model` | `(work_id, branch_id, source_type)`；GIN `tsv`；HNSW `embedding` |

### 4.11 关键约束

- 所有故事表必须带 `work_id` 和 `branch_id`。
- `chapters` 的 `current_version_id` 必须指向同一章节的版本。
- `canon_snapshots.commit_id` 唯一，保证一次提交一个快照。
- `facts` 的 `valid_from` 和 `valid_to` 用故事时间，不用真实时间。
- `knowledge_states` 必须引用合法事实。
- `jobs.status` 和 `job_steps.status` 使用固定枚举。
- 删除作品只做软删除，30 天后由清理任务永久删除。

### 4.12 V2 主模型补充

本节是主数据模型的一部分，优先于上面旧的冲突定义：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `agent_runs` | `id`, `job_id`, `work_id`, `branch_id`, `role`, `status`, `input_hash`, `output`, `citations`, `usage`, `started_at`, `finished_at` | 每次代理执行 |
| `agent_tool_calls` | `id`, `agent_run_id`, `tool_name`, `input`, `output`, `status`, `error` | 工具白名单调用和审计 |
| `context_pack_versions` | `id`, `generation_request_id`, `compiler_version`, `token_budget`, `selected`, `evicted`, `source_refs`, `snapshot` | 上下文包可复现版本 |
| `prompt_versions` | `id`, `key`, `version`, `content`, `schema`, `active` | Prompt 版本真源 |
| `review_decisions` | `id`, `target_type`, `target_id`, `action`, `risk`, `reason`, `actor_id`, `created_at` | 章节/事实/合并决策 |
| `import_jobs` / `import_chunks` / `import_candidates` / `import_conflicts` / `import_reports` | 见 14.3 | 导入任务与候选 |
| `story_bibles` / `genre_packs` / `custom_field_defs` / `custom_field_values` | 见 14.4 | 故事圣经与题材扩展 |
| `map_layers` / `map_nodes` / `map_edges` / `map_markers` / `map_control` | 见 14.4 | 地图与势力控制 |
| `power_systems` / `golden_fingers` / `items_techniques` / `timelines` | 见 14.4 | 力量、金手指、物品、时间线 |
| `golden_three_candidates` / `golden_three_reviews` | 见 14.4 | 黄金三章候选和六维评审 |
| `merge_items` / `merge_decisions` | 见 14.5 | 逐对象摘取 |
| `job_work_items` / `job_step_attempts` / `cost_reservations` | 见 14.6 | 父卷章任务与成本硬停 |
| `eval_cases` / `eval_runs` / `eval_scores` / `eval_gates` | 见 14.7 | 评测和发布门禁 |
| `feedback_events` | `id`, `user_id`, `work_id`, `target_type`, `target_id`, `action`, `reason`, `before`, `after`, `created_at` | 作者反馈 |
| `notifications` | `id`, `user_id`, `type`, `target_type`, `target_id`, `payload`, `read_at`, `created_at` | 站内通知 |
| `moderation_cases` | `id`, `work_id`, `chapter_id`, `status`, `rule_basis`, `decision`, `appeal`, `created_at` | 内容审核与申诉 |
| `export_receipts` / `deletion_requests` | `id`, `user_id`, `work_id`, `status`, `completed_at`, `expires_at` | 导出凭证和删除状态 |

## 5. API 设计

### 5.1 通用约定

- REST，前缀 `/api/v1`。
- 请求和响应使用 JSON。
- 列表接口使用游标分页：`cursor`、`limit`。
- 错误统一返回 `code`、`message`、`details`、`requestId`。
- 创建类接口支持 `Idempotency-Key`。
- 修改类接口支持 `If-Match` 或 `version`，做乐观并发。
- 所有写接口做 Zod 校验。
- OpenAPI 由 NestJS Swagger 生成。

### 5.2 认证和账号

```text
POST   /api/v1/auth/register/send-code
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/logout-all
GET    /api/v1/auth/me
POST   /api/v1/auth/password/forgot
POST   /api/v1/auth/password/reset
PATCH  /api/v1/auth/password

GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/users/me/pen-names
POST   /api/v1/users/me/pen-names
PATCH  /api/v1/users/me/pen-names/:penNameId
DELETE /api/v1/users/me/pen-names/:penNameId
POST   /api/v1/users/me/delete
GET    /api/v1/users/me/export
```

### 5.3 作品和分支

```text
GET    /api/v1/works
POST   /api/v1/works
GET    /api/v1/works/:workId
PATCH  /api/v1/works/:workId
DELETE /api/v1/works/:workId
POST   /api/v1/works/:workId/duplicate
POST   /api/v1/works/:workId/import
POST   /api/v1/works/:workId/archive
POST   /api/v1/works/:workId/restore

GET    /api/v1/works/:workId/branches
POST   /api/v1/works/:workId/branches
GET    /api/v1/works/:workId/branches/:branchId
PATCH  /api/v1/works/:workId/branches/:branchId
POST   /api/v1/works/:workId/branches/:branchId/archive
POST   /api/v1/works/:workId/branches/:branchId/compare
POST   /api/v1/works/:workId/branches/:branchId/cherry-pick
```

### 5.4 正史和设定

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/entities
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/entities/:entityId
GET/POST   /api/v1/works/:workId/branches/:branchId/relations
GET/POST   /api/v1/works/:workId/branches/:branchId/facts
GET/POST   /api/v1/works/:workId/branches/:branchId/knowledge-states
GET/POST   /api/v1/works/:workId/branches/:branchId/events
GET/POST   /api/v1/works/:workId/branches/:branchId/threads
GET/POST   /api/v1/works/:workId/branches/:branchId/foreshadows
GET/POST   /api/v1/works/:workId/branches/:branchId/character-arcs
POST       /api/v1/works/:workId/branches/:branchId/canon/commits
GET        /api/v1/works/:workId/branches/:branchId/canon/commits
GET        /api/v1/works/:workId/branches/:branchId/canon/snapshots/:snapshotId
POST       /api/v1/works/:workId/branches/:branchId/canon/audit
GET        /api/v1/works/:workId/branches/:branchId/canon/health
```

### 5.5 大纲和章节

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/outlines
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/outlines/:outlineId
POST       /api/v1/works/:workId/branches/:branchId/outlines/:outlineId/lock
POST       /api/v1/works/:workId/branches/:branchId/outlines/:outlineId/unlock
POST       /api/v1/works/:workId/branches/:branchId/outlines/:outlineId/regenerate

GET/POST   /api/v1/works/:workId/branches/:branchId/chapters
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/chapters/:chapterId
GET/POST   /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/scenes
GET/POST   /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions
GET        /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions/:versionId
POST       /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/restore/:versionId
GET        /api/v1/works/:workId/branches/:branchId/outline/readiness
```

### 5.6 生成和审校

```text
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/generate
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/continue
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/rewrite
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/expand
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/condense
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/change-pov
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/hooks
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/title
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/summary
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/extract-facts
POST /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/verify
GET  /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/context-preview
GET  /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/annotations
PATCH /api/v1/works/:workId/branches/:branchId/annotations/:annotationId
GET  /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/quality
```

### 5.7 修改和版本

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/changes
GET/PATCH/DELETE /api/v1/works/:workId/branches/:branchId/changes/:changeId
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/analyze
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/apply
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/reject
POST       /api/v1/works/:workId/branches/:branchId/changes/:changeId/branch
GET        /api/v1/works/:workId/branches/:branchId/changes/:changeId/impact
GET        /api/v1/works/:workId/branches/:branchId/versions
POST       /api/v1/works/:workId/branches/:branchId/rollback
```

### 5.8 任务和事件

```text
GET/POST /api/v1/works/:workId/branches/:branchId/jobs
GET      /api/v1/works/:workId/branches/:branchId/jobs/:jobId
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/pause
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/resume
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/cancel
POST     /api/v1/works/:workId/branches/:branchId/jobs/:jobId/retry
GET      /api/v1/works/:workId/branches/:branchId/jobs/:jobId/events
GET      /api/v1/works/:workId/branches/:branchId/review-queue
```

`/jobs/:jobId/events` 使用 SSE，返回任务步骤、进度、token 和错误事件。

### 5.9 模型、导出、搜索

```text
GET/POST   /api/v1/model-configs
GET/PATCH/DELETE /api/v1/model-configs/:configId
POST       /api/v1/model-configs/:configId/test
GET        /api/v1/model-configs/providers
GET        /api/v1/usage

GET/POST   /api/v1/works/:workId/branches/:branchId/exports
GET        /api/v1/works/:workId/branches/:branchId/exports/:exportId
GET        /api/v1/works/:workId/branches/:branchId/exports/:exportId/download
GET/POST   /api/v1/export-templates
POST       /api/v1/works/:workId/branches/:branchId/publish-check

GET        /api/v1/works/:workId/branches/:branchId/search
GET        /api/v1/search
POST       /api/v1/search/reindex
GET        /api/v1/health
GET        /api/v1/health/ready
```

### 5.10 V2 路由收敛

以下路由是 V2 唯一真源，旧的 `branch_commits`、`canon_commits`、`cherry-pick` 路由只做兼容代理：

```text
GET/POST   /api/v1/works/:workId/branches/:branchId/versions/nodes
GET        /api/v1/works/:workId/branches/:branchId/versions/nodes/:nodeId
POST       /api/v1/works/:workId/branches/:branchId/versions/compare
POST       /api/v1/works/:workId/branches/:branchId/versions/rollback
GET        /api/v1/works/:workId/branches/:branchId/head

POST       /api/v1/imports
GET        /api/v1/imports/:importId
POST       /api/v1/imports/:importId/cancel
POST       /api/v1/imports/:importId/resume
GET        /api/v1/imports/:importId/report

POST       /api/v1/works/:workId/branches/:branchId/review/:targetType/:targetId
GET        /api/v1/works/:workId/branches/:branchId/review-queue

GET/POST   /api/v1/works/:workId/branches/:branchId/merge-items
POST       /api/v1/merge-items/:itemId/decide
POST       /api/v1/merge-items/:itemId/apply

GET/POST   /api/v1/works/:workId/branches/:branchId/eval-runs
GET        /api/v1/works/:workId/branches/:branchId/eval-gates
```

## 6. 任务状态机与 Worker

### 6.1 任务状态

```text
queued
  → preparing
  → running
  → waiting_review
  → completed

preparing → failed
running → failed
any → paused
paused → queued
any → canceled
```

### 6.2 任务步骤

```text
readiness
  → brief
  → context
  → draft
  → self_check
  → revise
  → extract_facts
  → verify
  → review
  → commit
  → summarize
```

### 6.3 BullMQ 与 Postgres 分工

- BullMQ 负责投递、延迟、重试和并发控制。
- Postgres 负责任务状态、步骤状态、检查点和业务幂等。
- Worker 收到 BullMQ 任务后，先读 `jobs` 和 `job_steps`，从最后一个成功检查点继续。
- 每个步骤成功后写 `job_steps` 和 `job_checkpoints`，再进入下一步。
- 收到暂停或取消时，在当前步骤结束后停止。
- 重试从失败步骤开始，不重复已成功步骤。

### 6.4 正史提交串行化

同一分支同一时间只能有一个正史写入者。

```sql
SELECT pg_advisory_xact_lock(hashtext(branch_id::text));
```

提交顺序：

1. 校验任务分支和正史版本。
2. 写入 `canon_events`。
3. 更新投影表。
4. 写入 `version_nodes` 的 `canon_commit` 节点和 `canon_snapshots`。
5. 更新 `work_branches.head_node_id`。
6. 写 `job_events`，推送 SSE。

### 6.5 事件

```text
job.created
job.preparing
job.step.started
job.step.succeeded
job.step.failed
job.progress
job.waiting_review
job.paused
job.resumed
job.canceled
job.completed
job.failed
```

### 6.6 章节、事实与正史状态

章节状态：`planned`、`writing`、`waiting_review`、`changes_requested`、`approved`、`locked`、`published`、`rejected`。

事实提案状态：`proposed`、`confirmed`、`modified`、`rejected`、`superseded`。

章节批准只锁定章节；事实确认单独记录；正史提交只由 Canon Curator 执行，且必须满足“已批准/锁定章节 + 已确认事实”或自动通过谓词。所有决策写入 `review_decisions`。

## 7. 认证、安全与审计

### 7.1 认证

- 邮箱验证码注册。
- Argon2id 密码哈希。
- Opaque session token，数据库存 hash。
- httpOnly、Secure、SameSite=Lax Cookie。
- 登录、验证码、找回密码、导出、生成接口限流。
- 支持退出所有设备。

### 7.2 模型 Key

- AES-256-GCM 信封加密。
- 主密钥来自环境变量或密钥管理服务。
- 保存后不回传明文。
- 日志和错误信息脱敏。
- 每个用户只能访问自己的配置。

### 7.3 审计

- 登录、注销、改密、改邮箱。
- 模型 Key 创建、更新、删除。
- 作品创建、删除、恢复、导出。
- 正史提交、修改应用、回滚。
- 记录 `user_id`、动作、目标、IP、User-Agent、时间。

### 7.4 数据隔离

- 所有故事表启用 RLS，并以 `app.user_id` 作为租户上下文；所有查询必须带 `user_id`。
- 所有故事数据必须带 `work_id` 和 `branch_id`。
- 每张租户表必须有 `user_id`，或通过 `work_id` 建立明确的 RLS JOIN 策略；必须通过跨用户读写测试。
- 仓储层统一注入当前用户上下文。
- 禁止 controller 直接拼 SQL。
- Provider 只允许 DeepSeek 官方和显式白名单；自定义 Base URL 必须 HTTPS，禁止私网、回环、链路本地地址和重定向。
- 正文、上下文包和 prompt 不写普通日志；追踪服务默认关闭或自托管。
- 注销 30 天后硬删除作品、正文、版本、正史、上下文包和轨迹；备份在 30 天内过期。

## 8. AI 层

### 8.1 AiModule

- `ModelConfigService`：模型配置 CRUD、加密、测试连接。
- `AiGateway`：封装 Vercel AI SDK，解析用户配置，支持流式和结构化输出。
- `PromptRegistry`：按 key 和 version 读取 Prompt。
- `UsageRecorder`：记录 token、费用、延迟和模型。
- `LangfuseTracer`：记录 LLM 调用链。

### 8.2 领域接口

`packages/core` 只依赖接口，不依赖具体模型：

```ts
interface GenerationGateway {
  generateText(input: GenerationInput): Promise<GenerationResult>;
  streamText(input: GenerationInput): AsyncIterable<GenerationChunk>;
  generateObject<T>(input: ObjectGenerationInput<T>): Promise<T>;
}
```

Worker 和 API 都通过 `AiService` 获取实现。

### 8.3 上下文编译与校验

- `ContextCompiler` 在 `packages/core`，负责按 token 预算组装上下文。
- `Verifier` 在 `packages/core`，负责事实抽取后的冲突检查。
- `packages/ai` 只负责模型调用和结构化输出。
- 上下文包和校验结果都写入数据库，便于审计和复现。

## 9. 部署与可观测性

### 9.1 局域网

```text
caddy
web
api
worker
postgres
redis
minio
```

V1 先按单机 Docker Compose 部署。MinIO 存导出、地图、封面和附件。Caddy 负责反向代理和本地 TLS。注册验证码和找回密码需要配置 SMTP；如果没有 SMTP，只能由运维用 CLI 重置密码。

### 9.2 云上

- V1 支持单机云 VM Docker Compose，运行 `web`、`api`、`worker`。
- 单机云 VM 可以使用自建 Postgres/Redis/MinIO 或兼容服务。
- 托管 Postgres、托管 Redis、容器编排和对象存储托管服务属于后续增强。
- Caddy 处理 TLS；云负载均衡后续。

### 9.3 可观测性

- 日志：pino，结构化，脱敏。
- 追踪：OpenTelemetry。
- 错误：Sentry。
- LLM 追踪：Langfuse。
- 指标：Prometheus 和 Grafana。
- 健康检查：`/api/v1/health`、`/api/v1/health/ready`。

### 9.4 备份

- 每日 Postgres 备份，保留 30 天。
- 每日对象存储备份，保留 30 天；导出文件、地图、封面和附件都纳入清理。
- 本地备份写到独立磁盘或 NAS，云上使用对象存储版本控制。
- 定期恢复演练。
- 迁移通过 `drizzle-kit`，部署时先跑迁移再启动新版本。

## 10. 测试策略

- 测试框架统一用 Vitest；NestJS 用 `unplugin-swc` 兼容装饰器和元数据。
- E2E 用 Playwright。
- 单元测试：上下文编译、正史校验、影响分析、token 预算。
- 集成测试：NestJS 模块、Drizzle 仓储、Postgres、Redis。
- API 测试：Supertest 加 Vitest。
- E2E：Playwright 覆盖注册、建作品、写章、生成、修改、导出。
- 评测：黄金章节集，Langfuse 记录，人工盲评。
- 压测：1000 万字作品、3000–4000 章、并发任务、SSE、索引重建、备份恢复。

## 11. 构建顺序

`B0–B5` 是工程构建顺序，`M0–M3` 是产品里程碑。多个 B 阶段可以并行，但 M 里程碑按累计能力验收。`B0–B5` 不再使用 `P` 前缀，避免和上下文优先级、缺陷等级混淆。

| 工程阶段 | 内容 | 对应里程碑 | 验收 |
| --- | --- | --- | --- |
| B0 | monorepo、Docker Compose、Postgres、Redis、NestJS API/Worker、Drizzle 迁移 | M0 | 服务能启动，健康检查通过 |
| B1 | 认证、用户、作品、分支、模型配置、AI 网关 | M0 | 能注册登录、建作品、配 Key、测试连接 |
| B2 | 正史实体、设定、章纲、写作台、单章生成 | M1 | 能生成一章、确认事实并提交本章事实 |
| B3 | 连续性校验、修改请求、影响分析、版本、平行版本 | M2 | 能改设定并看到影响 |
| B4 | 批量生产、任务中心、审计、导出 | M2 | 能按卷生成并导出 |
| B5 | 质量评测、性能优化、部署加固 | M3 | 通过 V1 验收 |

## 12. 性能与并发目标

### 12.1 本地部署基线

- 机器：8 vCPU、16GB 内存、100GB SSD，单机 Docker Compose。
- 全局 Worker 并发：4。
- 单作品并发：2。
- 单用户并发：2。
- 正史提交：每分支同时 1 个写入者。
- 交互式单章生成单独走优先级更高的队列，优先于批量任务。
- 每用户同时 2 个模型请求，全局 4 个；遇到 429 自动退避。
- 单章 2500–3500 字，目标不超过 5 分钟。
- 100 章一卷可按 overnight 批处理。
- 3000–4000 章按卷推进，支持断点恢复，不能要求一次性跑完。
- CRUD 接口 p95：小于 300ms。
- 搜索接口 p95：小于 1 秒。
- 流式首 token：小于 5 秒。
- SSE 事件延迟：小于 1 秒。
- 备份：每日一次，RPO 24 小时，RTO 4 小时。

这些是 V1 起始目标，模型供应商的限流和延迟会直接影响单章和整卷耗时，后续用压测和真实任务数据校准。

## 13. 已确认决策与剩余风险

### 13.1 已确认决策

- 先局域网部署，MinIO 做本地对象存储，云厂商和云存储后续再定。
- 中文检索 V1 用 `pg_trgm` + `simple tsvector`，不装 `zhparser`；`pgvector` 作为后续增强。
- 测试框架统一 Vitest，NestJS 用 `unplugin-swc`，E2E 用 Playwright。
- 首批模型供应商为 DeepSeek 官方 API，OpenAI 兼容接口。
- DeepSeek Base URL 使用 `https://api.deepseek.com`，模型名以官方当前文档为准。
- 默认模型建议 `deepseek-chat`，规划或校验可配 `deepseek-reasoner`，以官方当前模型名为准。
- Worker 并发和性能目标采用上面第 12 节的基线。

### 13.2 剩余风险

- 1000 万字下的上下文编译、检索、索引重建和备份恢复性能。
- 章节版本长期存储和备份体积。
- DeepSeek 限流、模型变更和价格变化。
- 单机部署的可用性和恢复能力。
- 合规和内容审核的具体落地。

## 14. ADR 0016–0023 实现契约

> 本节优先于第 4、6、7、8、10 节中与 ADR 0016–0023 冲突的旧定义。字段细节可在 `/to-spec` 展开，但表、状态、唯一真源和门禁不能改变。

### 14.1 单一版本图（ADR 0016）

新增 `version_nodes` 作为每个分支唯一版本真源：

| 列 | 说明 |
| --- | --- |
| `id` | 版本节点 ID |
| `branch_id` | 所属分支 |
| `parent_node_id` | 唯一父节点，根节点为空 |
| `node_type` | `chapter_version` / `outline_version` / `canon_commit` / `snapshot` / `change_apply` / `branch_merge` / `rollback` |
| `object_type` / `object_id` / `object_version` | 节点关联对象 |
| `snapshot_id` | 正史提交节点必填 |
| `payload` | 节点事件和差异摘要 |
| `actor_id` / `message` / `created_at` | 审计信息 |

不变量：每节点只有一个父节点；同一分支无环；每分支只有一个 head；正史提交节点必须有快照；合并、摘取和回滚都创建新节点。`branch_commits`、`canon_commits` 不再作为独立父链，迁移后作为 `version_nodes` 的视图或遗留读写层。章节版本、大纲版本、快照和修改请求都必须引用版本节点。

API：`GET /versions/nodes`、`GET /versions/nodes/:nodeId`、`POST /versions/compare`、`POST /versions/rollback`、`GET /branches/:branchId/head`。

### 14.2 审核、事实与正史状态机（ADR 0017）

章节状态：`planned`、`writing`、`waiting_review`、`changes_requested`、`approved`、`locked`、`published`、`rejected`。

事实提案状态：`proposed`、`confirmed`、`modified`、`rejected`、`superseded`。

新增 `review_decisions`：`id`、`work_id`、`branch_id`、`target_type`、`target_id`、`action`、`risk`、`reason`、`actor_id`、`created_at`。章节批准只锁定章节；事实确认单独记录；正史提交只由 Canon Curator 执行，且必须满足“已批准/锁定章节 + 已确认事实”或自动通过谓词。

自动通过谓词：标准质量、锁定大纲、无高风险、无未解决 P0。人物死亡、金手指升级、锁定事实修改、地图/势力根本变化、跨卷主线变更、分支合并永远人工确认。

API：`POST /chapters/:id/review`、`POST /chapters/:id/facts/:factId/confirm`、`POST /chapters/:id/facts/:factId/reject`、`POST /branches/:branchId/canon/commit`、`GET /review-queue`。

### 14.3 导入任务与千万字分块（ADR 0018）

新增：

| 表 | 关键列 |
| --- | --- |
| `import_jobs` | `id`, `work_id`, `branch_id`, `mode` (`manuscript_text`/`manuscript_extract`/`settings`), `status`, `total_chunks`, `finished_chunks`, `error`, `created_by` |
| `import_chunks` | `id`, `import_job_id`, `chunk_index`, `source_range`, `status`, `checkpoint`, `error` |
| `import_candidates` | `id`, `import_job_id`, `candidate_type`, `payload`, `source_sentence`, `confidence`, `status` |
| `import_conflicts` | `id`, `import_job_id`, `candidate_id`, `conflict_type`, `evidence`, `status` |
| `import_reports` | `id`, `import_job_id`, `summary`, `accepted`, `pending`, `conflicts`, `unparsed` |

旧稿默认文本导入不创建候选；旧稿“设定提取”和“设定导入”才创建候选、冲突和报告。设定导入接受作者已有的部分或完整设定，进入候选映射和冲突裁决，不影响旧稿导入。导入按文件/卷/章块或设定类型分块后台处理，支持断点、取消和部分失败。20 MB 不是产品上限；单文件/总大小可配置。导入文本视为不可信数据，不执行内容、不覆盖系统指令。

API：`POST /imports`、`GET /imports/:id`、`POST /imports/:id/cancel`、`POST /imports/:id/resume`、`GET /imports/:id/report`、`POST /imports/:id/candidates/:candidateId/accept`、`POST /imports/:id/candidates/:candidateId/reject`。

### 14.4 一等领域模型（ADR 0019）

新增专用表，不再把核心域塞进通用 `entities`/JSONB：

- `story_bibles`：九卡、完成度、版本、锁定、修订记录。
- `genre_packs`：pack key、版本、必填字段、规则、UI schema、迁移。
- `custom_field_defs` / `custom_field_values`：类型、适用对象、必填、选项、关系目标、启停、schema 版本。
- `map_layers` / `map_nodes` / `map_edges` / `map_markers` / `map_control`：图层、节点、边、旅行时间、标记、势力控制区。
- `power_systems`：层级、路径、突破条件、代价、瓶颈、克制、资源。
- `golden_fingers`：规则、代价、限制、成长曲线。
- `golden_three_candidates` / `golden_three_reviews`：候选、六维评分、作者决策、锁定、风格基线。

通用实体可以引用这些表，但不能替代。每个对象必须有版本、锁定、校验和 API。

### 14.5 选择性摘取（ADR 0020）

新增 `merge_items`：`id`、`work_id`、`source_branch_id`、`target_branch_id`、`object_type`、`object_id`、`source_node_id`、`diff`、`conflict_status`、`risk`、`decision`、`reason`、`actor_id`。

新增 `merge_decisions`：逐项记录接受、拒绝、忽略原因和高风险二次确认。V1 不做自动整分支合并；应用摘取创建新的版本节点和正史提交节点。

API：`POST /branches/:branchId/merge-items`、`GET /branches/:branchId/merge-items`、`POST /merge-items/:itemId/decide`、`POST /merge-items/:itemId/apply`、`POST /merge-items/:itemId/rollback`。

### 14.6 批量任务 DAG 与成本硬停（ADR 0021）

`jobs` 增加 `parent_job_id`、`job_type`（`book`/`volume`/`chapter`/`step`）和 `work_item_key`。

新增：

- `job_work_items`：父任务、卷任务、章工作项、状态、尝试次数、幂等键、检查点、错误。
- `job_step_attempts`：步骤、尝试、输入哈希、输出、费用、错误。
- `cost_reservations`：调用前预留、调用后结算、单章/单卷/每 1 万字上限、超限事件。

失败章节默认不阻塞同卷其他章节；正史提交串行；成本超限硬停并暂停任务，不静默降级。

### 14.7 质量评测（ADR 0022）

新增 `eval_cases`、`eval_runs`、`eval_scores`、`eval_gates`。固定基准集包含 100–300 章合成样本、三题材和 20 个对抗连续性案例。指标：P0 事实丢失 0、知识边界违规 0、大纲贴合 ≥90%、钩子/文笔 ≥4/5、连续性冲突 ≤1/5 万字；真实读者追读率 ≥70% 仅在接入真实读者数据后启用。

任何 prompt、上下文策略、Agent 行为或模型参数改动都必须跑同一基准集，记录版本、样本、评分者和结果；未通过不得发布或自动提交正史。

### 14.8 安全、删除与内容治理（ADR 0023）

新增 `provider_allowlist`、`deletion_requests`、`export_receipts`、`moderation_cases`。

- BYOK：只允许 DeepSeek 官方和白名单 Provider；HTTPS；禁止私网、回环、链路本地和重定向。
- RLS：所有租户故事表启用 RLS，`SET LOCAL app.user_id`；跨用户访问必须自动化测试。
- 日志：Key、正文、上下文包和 prompt 不进普通日志；追踪默认关闭或自托管。
- 删除：账号注销前必须完成导出；作品永久删除前必须完成导出。30 天恢复期后硬删除正文、版本、正史、上下文包、轨迹和孤儿数据；备份 30 天内过期。
- 内容：供应商审核 + 作者责任；公开内容提供 AI 标识、规则依据和申诉入口。
