# 局域网与单机 VM 部署

## 前置条件

- Linux x64 或支持 Docker Desktop 的 Windows/macOS 主机，8 vCPU、16 GB 内存、100 GB SSD。
- Docker Engine 24+、Docker Compose 2.27+、Node.js 24、pnpm 12。
- 防火墙只开放 Caddy 的 80/443；Postgres、Redis、MinIO、API 和 Prometheus 保持私网访问。

## 首次部署

从 `.env.production.example` 建立部署环境文件，并替换全部占位值。`DATABASE_URL` 和 `REDIS_URL` 必须使用 Compose 内部主机名 `postgres`、`redis`，不能使用 localhost。`MODEL_CONFIG_ENCRYPTION_KEY` 必须是 32 个 UTF-8 字节的随机值，不是 64 字符 hex。生产 overlay 会对密钥使用必填变量，缺失时 Compose 直接失败：

```powershell
Copy-Item .env.production.example .env
docker compose --env-file .env -f infra/docker/compose.yml -f infra/docker/compose.production.yml config
docker compose --env-file .env -f infra/docker/compose.yml -f infra/docker/compose.production.yml up -d --build --wait
curl.exe --fail --silent --show-error https://novelbrain.example.com/health
docker compose --env-file .env -f infra/docker/compose.yml -f infra/docker/compose.production.yml exec -T -e API_URL=http://api:3001 -e WEB_URL=http://web:3000 -e MAILPIT_URL=http://mailpit:8025 -e METRICS_URL=http://api:3001/api/v1/metrics -e STORAGE_HEALTH_URL=http://minio:9000/minio/health/live -e REDIS_URL=redis://redis:6379 worker node apps/worker/scripts/stack-smoke.mjs
```

局域网开发或验收环境可使用基础 Compose：

```powershell
docker compose -f infra/docker/compose.yml up -d --build
pnpm stack:smoke
```

数据库迁移在 API/Worker 启动前由 `migrate` 一次性任务执行。MinIO bucket 由 `minio-init` 创建。Caddy 负责唯一公开入口。

生产 overlay 会清空 Postgres、Redis、Mailpit、MinIO、API 和 Prometheus 的宿主机端口，只发布 Caddy 的 80/443。Caddy 使用 `Caddyfile.production` 和 `APP_ORIGIN` 配置域名 TLS。生产 smoke 在 Worker 容器内通过 Compose 服务名访问内部依赖，避免为了探针重新公开私有端口。

## 日志保留

Compose 只负责输出结构化 stdout/stderr，不把本机 `docker logs` 当作生产日志后端。上线前必须由宿主机或平台日志系统采集 API/Worker 输出，并按 `LOG_RETENTION_DAYS=30` 配置保留与删除策略；该策略继承 #133 的脱敏边界。Compose smoke 验证日志字段与脱敏契约，不替代外部日志后端的 retention 验收。

## 健康、指标与告警

- `/api/v1/health` 只判断 API 进程是否存活，不访问依赖。
- `/api/v1/health/ready` 检查 Postgres、Redis，并在配置时检查 MinIO。
- Worker 健康检查运行 `node apps/worker/dist/readiness-cli.js`，同时检查数据库、队列消费者和 MinIO。
- Prometheus 抓取 `/api/v1/metrics` 与 MinIO `/minio/v2/metrics/cluster`。
- 规则位于 `infra/observability/alerts.yml`，阈值和 runbook 见 `alerting.md`。

## 诊断

```powershell
docker compose -f infra/docker/compose.yml ps
docker compose -f infra/docker/compose.yml logs --since 30m api worker migrate minio
docker compose -f infra/docker/compose.yml exec api node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(async r=>console.log(r.status,await r.text()))"
```

只使用 request/job/run/model-call ID、哈希、错误码和资源状态，不复制正文、Prompt、ContextPack 或 Key。

## 更新

1. 先运行 `pnpm check` 和备份检查。
2. 拉取已合并版本并重建镜像。
3. 观察 `migrate` 成功、生产 readiness 为 `ready`、生产 smoke 通过。
4. 查看 API/队列/成本/存储告警 15 分钟。

## Rollback

代码回滚和数据库回滚分开处理。应用回滚：

```powershell
git switch --detach <previous-release-commit>
docker compose --env-file .env -f infra/docker/compose.yml -f infra/docker/compose.production.yml up -d --build --wait
docker compose --env-file .env -f infra/docker/compose.yml -f infra/docker/compose.production.yml exec -T -e API_URL=http://api:3001 -e WEB_URL=http://web:3000 -e MAILPIT_URL=http://mailpit:8025 -e METRICS_URL=http://api:3001/api/v1/metrics -e STORAGE_HEALTH_URL=http://minio:9000/minio/health/live -e REDIS_URL=redis://redis:6379 worker node apps/worker/scripts/stack-smoke.mjs
```

如果新迁移不向后兼容，不要直接回滚镜像；先按 #136 的恢复流程从迁移前备份恢复，再回到上一版本。仅回滚容器而保留不兼容 schema 不是有效回滚。
