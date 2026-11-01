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
- MinIO 控制台：http://localhost:9001

## 本地开发

```bash
pnpm install
docker compose up -d postgres redis minio
$env:DATABASE_URL="postgres://novel:novel@localhost:5432/novel"
pnpm db:migrate
pnpm db:seed
pnpm dev
```

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
- Drizzle 迁移和 seed 可执行。
- Worker 有一个 BullMQ 示例任务，写入 `system_jobs`。
- Vitest、Playwright、lint、typecheck 和 CI 可用。

## 文档

- `docs/requirements/v1-requirements.md`
- `docs/technical/nestjs-backend-design.md`
- `docs/specs/v1-spec.md`
- `GLOSSARY.md`
- `docs/adr/0001-canon-first-story-state.md`
