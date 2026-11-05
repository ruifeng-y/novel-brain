# NovelBrain

墨舟（NovelBrain）的生产 monorepo。当前实现是 M0 可运行工程骨架，包含 Web、API、Worker、共享契约、数据库和确定性 AI 测试接缝。

## 本地启动

需要 Node.js 22+、pnpm 10+ 和 Docker Compose。

```bash
pnpm install
pnpm stack:up
```

启动后：

- Web（Caddy 入口）：<http://localhost:3000>
- 健康页：<http://localhost:3000/health>
- API（仅本机回环）：<http://localhost:3001/api/v1/health>
- Mailpit：<http://localhost:8025>

停止并清理容器：

```bash
pnpm stack:down
```

## 测试

运行初始单元与契约测试：

```bash
pnpm test
```

运行需要 PostgreSQL 与 Redis 的 API 集成测试：

```bash
pnpm test:integration
```

运行全部本地检查：

```bash
pnpm check
```

运行生产页面结构测试：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Compose 启动后验证 Web、API、Mailpit、Postgres、Redis 和 Worker：

```bash
pnpm stack:smoke
```

从 NestJS API 和共享 Zod schema 重新生成 OpenAPI 文档与类型：

```bash
pnpm --filter @novel-brain/api openapi:generate
```

有真实 DeepSeek 凭据时运行 gated smoke；命令只报告凭据是否存在，不打印凭据值：

```bash
pnpm smoke:deepseek
```

缺少凭据时 smoke 记录 `skipped` 并以成功退出；演示前强制要求真实证据时设置
`REQUIRE_DEEPSEEK_SMOKE=1`。证据输出到 `artifacts/playwright/deepseek-smoke.json`。

M0 内部演示步骤见 `docs/demo/m0-author-demo.md`。

## 结构

```text
apps/web          Next.js 应用壳层与页面
apps/api          NestJS HTTP API
apps/worker       NestJS standalone Worker
packages/contracts  Zod 请求/响应/Job 契约与 OpenAPI JSON Schema
packages/core     框架无关核心工具
packages/db       Drizzle schema 与迁移
packages/ai       AI Gateway 与确定性 fake provider
infra/docker      Dockerfile 与 Compose
```

Worker 不暴露 HTTP；容器健康检查通过 `apps/worker/dist/readiness-cli.js` 检查数据库、队列和正在消费队列的 Worker。
