# NovelBrain

面向个人作者的长篇 AI 创作平台。当前处于 M0 平台底座阶段。

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
$env:DATABASE_URL="postgres://novel:novel@localhost:5432/novel"
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

如果本机 Playwright 浏览器下载不可用，可以通过 `PLAYWRIGHT_EXECUTABLE_PATH`
指向现有的 Chromium 可执行文件。

## 常用命令

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## M0 范围

- Web、API、Worker、Postgres、Redis、MinIO 可启动。
- API 有存活和就绪检查。
- 邮箱验证码注册、密码登录、Cookie 会话和退出所有设备可用。
- 作者可保存加密的 DeepSeek 模型配置，并为规划、正文和校验分配用途。
- 本地验证码邮件会进入 Mailpit。
- Drizzle 迁移和 seed 可执行。
- Worker 有一个 BullMQ 示例任务，写入 `system_jobs`。
- 作者可从章纲生成整章，在写作台流式查看、编辑并保存章节版本；失败时保留草稿。
- 作者可确认、修改或驳回本章事实；确认后写入已确认设定，并在下一章生成时作为上下文使用。
- Vitest、Playwright、lint、typecheck 和 CI 可用。

## 文档

- `docs/requirements/v1-requirements.md`
- `docs/technical/nestjs-backend-design.md`
- `docs/specs/v1-spec.md`
- `GLOSSARY.md`
- `docs/adr/0001-canon-first-story-state.md`
