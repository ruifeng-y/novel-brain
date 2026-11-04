# M0-01 工程骨架与健康探针

> Issue: #67
> Capability IDs: OPS-001, UI-001, UI-002, UI-006

## 实现范围

- pnpm workspace 包含 `apps/web`、`apps/api`、`apps/worker` 和 `packages/contracts`、`packages/core`、`packages/db`、`packages/ai`。
- Docker Compose 启动 Web、API、Worker、Postgres 16、Redis 7、Mailpit 和一次性 fake AI smoke。
- API 提供 `/api/v1/health` 与 `/api/v1/health/ready`；readiness 实际检查 Postgres 与 Redis，并在任一依赖不可用时返回 `503`。
- Web 提供 `/health` 健康页与 `/workspace` 壳层占位页，使用签收原型中的墨舟设计令牌。
- Worker 使用 BullMQ 消费共享 job 契约，不暴露 HTTP；readiness CLI 检查数据库、队列和正在消费队列的 Worker。
- `packages/contracts` 的 Zod schema 同时被 Web、API 和 Worker 消费。
- `apps/api/openapi.json` 由 NestJS Swagger 生成，响应 schema 来自共享 Zod 契约；`apps/api/src/generated/openapi.d.ts` 从该文档派生，并在 CI 中校验无漂移。
- `packages/ai` 提供确定性 fake provider；测试禁止网络调用。
- GitHub Actions 执行格式、lint、类型检查、单元/契约测试、构建和 Playwright 结构测试。

## 命令

```bash
pnpm stack:up
pnpm test
pnpm check
pnpm stack:smoke
```

## 验证接缝

- API：通过 `/api/v1` HTTP 边界验证 liveness、ready 和 503。
- Worker：通过 BullMQ 在线消费者数量和 readiness CLI 验证队列连接与健康状态；持久化生成执行属于 #76，不在本 ticket 伪实现。
- AI：通过一次性 Compose smoke 和 `AiGateway` 测试验证确定性输出且不访问网络。
- Web：通过 Playwright 在 390、900、1180、1440 四档宽度验证页面结构、状态和无横向溢出。

## 验证结果

- `pnpm check`：通过，5 个测试文件、14 个测试。
- `pnpm test:e2e`：通过，4 个测试覆盖健康页正常/依赖失败/超时和壳层四档响应式；四档健康页截图附加到 Playwright CI artifact。
- `pnpm stack:smoke`：通过，Web、API、Mailpit、Postgres、Redis 与 Worker 队列消费者可用。
- 故障注入：停止 Redis 时 liveness 返回 200、readiness 返回 503；恢复 Redis 后 readiness 返回 200。
- 真实布局检查：1440 和 390 宽度下页面无横向溢出，侧栏、主区和状态卡无重叠。

## 边界与证据

- #67 提供面向已登录工作区的应用壳层占位；真实认证、会话和 CSRF 由 #68 实现，本 ticket 不声称已有认证。
- `/workspace` 是壳层占位，不是 #70 的完整工作台；生产 dashboard parity 状态保持 `production-pending`。
- UI-006 在本 ticket 的证据是四档 Playwright 结构断言、非空 PNG 校验和 CI 截图 artifact；生产 golden 基线按 ADR 0027 必须等作者对照原型签收后创建，本 ticket 不提交未经签收的 golden。
- 真实 Compose 使用独立 project `novel-brain-m0`，避免复用或删除既有本地数据卷。
