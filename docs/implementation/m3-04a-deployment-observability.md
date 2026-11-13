# M3-04a 部署、健康探针、指标与成本告警

> Issue: #135  
> Capabilities: OPS-001, OPS-003  
> Status: implementation complete; PR CI pending

## 1. 实现范围

- 基础 Compose 增加固定版本 MinIO、bucket 初始化、Prometheus 和宿主机端口变量。
- 生产 overlay 对数据库、认证、代理、模型密钥、Provider allowlist、SMTP 和对象存储变量使用必填环境变量。
- API liveness 只判断进程；readiness 在配置对象存储后同时检查 Postgres、Redis 和 MinIO。
- Worker readiness CLI 检查数据库、队列消费者和 MinIO。
- `/api/v1/metrics` 输出 Prometheus 文本，覆盖 API 延迟、队列深度/最老任务、24 小时任务结果、模型延迟/token/费用和依赖可用性。
- `/metrics` 不进入 OpenAPI，也不通过公开 Web 代理暴露。
- MinIO 自带指标由 Prometheus 抓取，用于真实存储容量与使用量。
- 告警规则、阈值说明、故障 fixture 和逐步 runbook 已纳入 guardrail。
- 部署 runbook 覆盖前置条件、首次部署、更新、诊断和 rollback。

## 2. 验收证据

- 独立 Compose project 使用备用端口完成镜像构建和 `--wait` 启动。
- `pnpm stack:smoke` 验证 Web、API readiness、Mailpit、Worker、MinIO、metrics，以及公开 Web origin 不暴露 metrics。
- Prometheus 两个 target 均为 `up`：`novelbrain-api`、`novelbrain-minio`。
- Prometheus 成功加载 9 条 `novelbrain-operations` 规则。
- 生产 overlay 在注入必填变量后通过 `docker compose config --quiet`。
- 健康、metrics service/controller/middleware、数据库聚合、队列快照和 Worker readiness 均有定向单测。
- AppModule 集成测试验证 liveness、readiness 与 metrics 同时可用。
- `scripts/test/deployment-guardrails.test.mjs` 和 `scripts/test/observability-guardrails.test.mjs` 校验规则、阈值、runbook 和部署资产。
- Production CI 新增 `Deployment Smoke` workflow，在干净 Ubuntu runner 构建并启动 Compose 后执行 smoke。

## 3. 运维边界

- 默认阈值是审查线，不是容量、RPO/RTO 或 SLA 已通过的证明。
- 备份恢复证据由 #136 负责，1000 万字容量证明由 #137 负责。
- 普通日志、trace、错误、SSE 与 metrics 的脱敏契约继承 #133。
- 对象存储指标来自固定版本 MinIO 的 Prometheus endpoint，不接受用户内容作为标签。
