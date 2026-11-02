# Ticket #31 性能证据

- `metrics.json`：本 ticket 在 3,000,000 字、1,000 章夹具上的原始测量结果。
- 完整报告：`docs/acceptance/m3/performance.md`。

复现：

```powershell
docker compose -p novel-brain-ticket31-perf `
  -f docker-compose.yml `
  -f infra/docker/compose.performance.yml `
  up -d --build --wait

pnpm benchmark:performance
```

默认 API 地址为 `http://127.0.0.1:13001`，Postgres 管理连接为
`postgres://novel:novel@127.0.0.1:55432/novel`。可通过
`PERF_API_BASE_URL`、`PERF_DATABASE_ADMIN_URL`、`PERF_SESSION_SECRET` 和
`PERF_OUTPUT` 覆盖。

该夹具使用确定性 fake AI provider。测量结果只覆盖本地 API、数据库、队列、SSE 和
持久化链路；真实模型延迟和 30 章/1,000 章长跑为模型化结果，详见报告。
