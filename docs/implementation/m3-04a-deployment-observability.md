# M3-04a 部署、健康探针、指标与成本告警

> Issue: #135
> Capabilities: OPS-001, OPS-003
> Status: complete; PR #196 merged as `8fe594e`

## 1. 实现范围

- 基础 Compose 增加固定版本 MinIO、bucket 初始化、Prometheus 和宿主机端口变量。
- 生产 overlay 对数据库、认证、代理、模型密钥、Provider allowlist、SMTP 和对象存储变量使用必填环境变量。
- API liveness 只判断进程；readiness 在配置对象存储后同时检查 Postgres、Redis 和 MinIO。
- Worker readiness CLI 检查数据库、队列消费者和 MinIO。
- `/api/v1/metrics` 输出 Prometheus 文本，覆盖 API 延迟、队列深度/最老任务、最近 24 个 UTC 小时桶内的任务结果、模型延迟/token/费用和依赖可用性。
- Worker 将 Postgres 权威终态与模型调用聚合写入小时桶 Redis 计数器；API 读取当前及之前 23 个桶（约 23–24 小时），不跨租户扫描受 RLS 保护的故事表。
- `/metrics` 不进入 OpenAPI，也不通过公开 Web 代理暴露。
- MinIO 自带指标由 Prometheus 抓取，用于真实存储容量与使用量。
- 告警规则、阈值说明、故障 fixture 和逐步 runbook 已纳入 guardrail。
- 部署 runbook 覆盖前置条件、首次部署、更新、诊断和 rollback。

## 2. 验收证据

- 独立基础 Compose project 使用备用端口完成镜像构建和 `--wait` 启动。
- 生产 overlay 使用独立 project、`APP_ORIGIN=http://localhost` 完成镜像构建和 `--wait` 启动；Caddy 公网入口返回 200。
- 生产 Worker 容器使用 32-byte `MODEL_CONFIG_ENCRYPTION_KEY` 完成模型 Key 加密/解密 smoke。
- `pnpm stack:smoke` 验证 Web、API readiness、Mailpit、Worker、MinIO、metrics，以及公开 Web origin 不暴露 metrics。
- 生产 overlay 的 Worker 容器内 smoke 通过，验证内部服务名、Worker 消费、MinIO、Prometheus target 与 MinIO capacity 指标。
- 公开 Web proxy 拒绝 metrics 的大小写、编码斜杠和双重编码路径变体。
- Prometheus 两个 target 均为 `up`：`novelbrain-api`、`novelbrain-minio`。
- Prometheus 成功加载 9 条 `novelbrain-operations` 规则。
- `promtool test rules` 执行 `infra/observability/alerts.test.yml`，逐条验证 9 个告警的真实 PromQL 表达式。
- 生产 overlay 在注入必填变量后通过 `docker compose config --quiet`。
- 健康、metrics service/controller/middleware、Redis 运行时聚合、队列快照和 Worker readiness 均有定向单测。
- Redis 指标 recorder、API 聚合读取和 `/metrics` 有数据输出均有定向测试与集成断言。
- AppModule 集成测试验证 liveness、readiness 与 metrics 同时可用。
- `scripts/test/deployment-guardrails.test.mjs` 和 `scripts/test/observability-guardrails.test.mjs` 校验规则、阈值、runbook 和部署资产。
- Production CI 新增 `Deployment Smoke` workflow，在干净 Ubuntu runner 构建并启动 Compose 后执行 smoke。
- 外部日志后端负责 30 天 retention；Compose 通过必填 `LOG_RETENTION_DAYS=30` 和部署前置条件显式声明该边界。
- PR #196 的 `check`、`compose-smoke` 和 `playwright` 全部通过。合并后的 `main@8fe594e` 再次运行 `Production CI`，`check` 与 `playwright` 均通过。

## 3. 运维边界

- 默认阈值是审查线，不是容量、RPO/RTO 或 SLA 已通过的证明。
- 备份恢复证据由 #136 负责，1000 万字容量证明由 #137 负责。
- 普通日志、trace、错误、SSE 与 metrics 的脱敏契约继承 #133。
- 对象存储指标来自固定版本 MinIO 的 Prometheus endpoint，不接受用户内容作为标签。

## 4. 环境复盘

- Frontier 在 #135 合并后仍停留在 #133 之前的基线，导致下一次实现需要重新计算 ready leaf。Issue #197 以 GitHub 状态和依赖图重新对账，并更新 `docs/planning/implementation-frontier.md`。
- 提交信息校验器遗漏了已知技术词 `smoke`，首次由 PR CI 捕获。修复为该词加入技术词白名单并增加回归测试；PR 合并后，push CI 对旧提交重新校验通过。
- 本会话出现过误用非 PowerShell shell 的只读命令。命令失败且没有修改文件；后续继续显式使用原生 PowerShell，不为此增加无法可靠约束调用方的仓库脚本。
- `gh pr checks --watch` 的 GraphQL 连接曾中断一次，但 CI 未失败。后续长时等待优先使用 REST 单次查询轮询，并以 job 详情判断真实执行状态。

以上是流程和环境改进记录，不改变 #135 的产品范围或验收结论。
