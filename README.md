# NovelBrain

面向个人作者的长篇 AI 创作平台。当前是 V1 局域网/内部发布候选（RC），
**尚未批准公开发布**。

M0 到 M2 的创作闭环、批量生产、修改版本和安全能力已回归通过；M3 的导出、发布
检查、性能、安全、备份恢复和合规文档也已完成本地验收。B-01、B-02/B-03、B-04
和 B-07 工程门槛已关闭并通过复验，因此 **LAN/internal RC 为 GO**。

正式公开发布仍是 **NO-GO**：B-05 人工质量盲评、B-06 真实 DeepSeek、B-08
法务/运营确认、B-07 的真实云部署证据，以及 B-12/B-13 的工作级资料/设置和
独立大纲/历史版本导出仍未闭环。详见
`docs/acceptance/m3/acceptance.md` 和 `docs/release/v1-known-limitations.md`。

## 环境要求

- Node.js 22 或更高
- pnpm 10.20
- Docker 与 Docker Compose

## 一键启动

```bash
docker compose up --build
```

- Web：http://localhost
- API 健康检查：http://localhost/api/v1/health
- API 就绪检查：http://localhost/api/v1/health/ready
- Swagger：http://localhost/api/docs
- 邮件收件箱（Mailpit）：http://localhost:8025
- MinIO 控制台：http://localhost:9001

## 本地开发

```bash
pnpm install
docker compose up -d postgres redis mailpit minio
$env:DATABASE_URL="postgres://novel_app:novel_app@localhost:5432/novel"
$env:DATABASE_ADMIN_URL="postgres://novel:novel@localhost:5432/novel"
$env:SESSION_SECRET="development-session-secret"
$env:MODEL_KEY_ENCRYPTION_KEY="ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3iJmqu8zd7v8="
$env:SMTP_HOST="localhost"
$env:SMTP_PORT="1025"
$env:SMTP_FROM="noreply@novelbrain.local"
pnpm db:migrate
pnpm db:seed
pnpm dev
```

正文生成的 E2E 测试使用确定性 fake provider，不调用真实 DeepSeek：

```powershell
$env:AI_PROVIDER="fake"
docker compose up -d --build api worker web
pnpm test:e2e
```

Compose 里的 API 通过 `host.docker.internal` 访问 Playwright 启动的本地模型桩；
如果 API 直接跑在宿主机上，先设置 `$env:MODEL_PROVIDER_STUB_HOST="127.0.0.1"`。

如果本机 Playwright 浏览器下载不可用，可以通过 `PLAYWRIGHT_EXECUTABLE_PATH`
指向现有的 Chromium 可执行文件。

## 常用命令

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm demo:m0
pnpm demo:m1
pnpm demo:m2
pnpm demo:m3
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## M1 内部 beta 范围

- Web、API、Worker、Postgres、Redis、MinIO 可启动。
- API 有存活和就绪检查。
- 邮箱验证码注册、密码登录、Cookie 会话和退出所有设备可用。
- 作者可保存加密的 DeepSeek 模型配置，并为规划、正文和校验分配用途。
- 本地验证码邮件会进入 Mailpit。
- Drizzle 迁移和 seed 可执行。
- Worker 有一个 BullMQ 示例任务，写入 `system_jobs`。
- 作者可完成完整故事圣经、结构化设定中心、地图与势力、力量体系、物品功法、
  时间线、五层大纲和剧情账本。
- 作者可从章纲连续生成多章，在写作台流式查看、编辑并保存章节版本；失败时保留草稿。
- 作者可确认、修改或驳回本章事实；确认后写入已确认设定，并在下一章生成时作为上下文使用。
- 写作台提供连续性提示、六项质量报告、伏笔、人物状态和版本历史。
- Vitest、Playwright、lint、typecheck 和 CI 可用。

## M2 扩大 beta 范围

- 仙侠、历史和都市作品都能创建，并用各自题材包生成章节。
- 历史题材提供架空古代、穿越争霸、朝代官制、军制地理和时代错置检查。
- 都市题材提供城市、公司、家族、阶层、法律、金钱和人脉规则检查。
- 批量创作支持按章、按卷、自定义区间和全本，支持暂停、恢复、取消和失败重试。
- 审核队列支持批准、送写作台、驳回和记录原因后忽略。
- 修改请求提供差异、原因、来源、风险、影响分析和六项一致性检查。
- 平行版本支持从已保存版本分叉、并排比较和选择性摘取。
- 版本图支持不可删除的历史、单次修改撤销、完整回滚和审计导出。
- M2 验收使用确定性 fake provider，不调用真实 DeepSeek，也不代表公开发布质量。

## V1 发布候选范围

- 导出 TXT、Markdown、DOCX、EPUB，支持通用网文、起点和番茄预设。
- 发布建议、读者预览、六项发布检查、复制/下载检查报告。
- 数据隔离、Key 信封加密、限流、每日备份、30 天保留和恢复演练。
- 3,000,000 字 / 1,000 章性能门禁、SSE、并发和安全专项。
- 隐私政策、用户协议、AI 内容标识、内容审核和安全检查清单。

V1 正式公开发布前仍必须关闭：

- 目标读者盲评、人工质量量表和真实 DeepSeek 证据。
- 真实云环境的 TLS/HSTS、静态加密、日志 30 天保留、生产监控和异地备份证据。
- L-01 到 L-12 法务/运营确认。
- 工作级资料/设置（目标读者、章节字数、节奏、风格、禁忌、简介、标签、封面）。
- 独立大纲 Markdown/JSON 导出和历史版本导出。

生产部署使用 `docker-compose.production.yml` 与
`infra/caddy/Caddyfile.production` 覆盖本地配置；本地 `docker compose up` 仍使用
HTTP、Mailpit 和开发密钥。部署前运行：

```bash
pnpm deploy:check
pnpm deploy:verify --env-file /etc/novel-brain/production.env
```

## 文档

- `docs/requirements/v1-requirements.md`
- `docs/technical/nestjs-backend-design.md`
- `docs/specs/v1-spec.md`
- `GLOSSARY.md`
- `docs/adr/0001-canon-first-story-state.md`
- `docs/acceptance/m0/acceptance.md`
- `docs/acceptance/m1/acceptance.md`
- `docs/acceptance/m2/acceptance.md`
- `docs/acceptance/m3/acceptance.md`
- `docs/acceptance/m3/demo.md`
- `docs/operations/security-backup.md`
- `docs/operations/account-lifecycle.md`
- `docs/operations/content-moderation.md`
- `docs/operations/security-checklist.md`
- `docs/operations/production-deployment.md`
- `docs/operations/log-retention.md`
- `docs/compliance/legal-pending-items.md`
- `docs/compliance/m3-05-acceptance.md`
- `docs/acceptance/m3/restore-drill.md`
- `docs/acceptance/m3/security-audit.md`
- `docs/release/v1-release-notes.md`
- `docs/release/v1-migration-rollback-runbook.md`
- `docs/release/v1-known-limitations.md`
- `docs/release/v1-release-checklist.md`
