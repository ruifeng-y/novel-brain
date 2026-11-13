# 日志与追踪运维边界

## 普通日志

普通日志只允许记录：

- request ID、job ID、run ID、model call ID、reservation ID 和审计 correlation ID。
- Prompt、ContextPack 与正文的哈希、长度和引用 ID。
- Provider、模型名、状态、错误码、耗时、token 与费用。
- 不含用户内容的低基数指标标签。

普通日志不得记录 API Key、authorization header、正文、完整 prompt、ContextPack 快照、导入原文或其他用户私有内容。自由文本消息和无法归类为机器诊断值的字符串会替换为 `[REDACTED]`。

API 错误顶层文案按 HTTP 状态返回固定安全文案；`details` 只保留状态机、标识符、计数、哈希、规则码和路径等机器诊断字段。`key` 只接受登记就绪项或登记前缀，provider、status 等字段只接受对应枚举。自由文本详情不会被复制到响应。

## 追踪

追踪默认关闭。自托管追踪必须同时配置：

```text
TRACE_MODE=self_hosted
TRACE_RETENTION_DAYS=<1-365>
TRACE_ENDPOINT=<http(s) endpoint>
```

只设置 endpoint 或 retention、但不显式设置 `TRACE_MODE=self_hosted` 时，API/Worker 应启动失败。追踪策略在启动日志中只记录 mode、retention 和 endpoint 是否已配置，不记录 endpoint 本身。

endpoint 只接受 localhost、IPv4 私网、IPv6 loopback/ULA/link-local、`*.internal`、`*.local` 或集群内部主机名。公开第三方域名和公网 IPv6 会使 API/Worker 启动失败。启用后，API/Worker 启动时会发送只含安全属性的 `service.started` trace envelope；信封名称、时间、属性和字段名均执行格式与 canary 校验，导出失败会阻止服务启动。

`retentionDays` 随每次 trace 导出传给自托管接收端；实际 TTL 和过期删除由接收端按该字段执行。应用端负责拒绝缺失保留期、匿名第三方 endpoint 和重定向，避免把 trace 导出到未声明的接收位置。

## 脱敏 canary

部署扫描可以设置：

```text
LOG_CANARY_VALUES=["KEY_CANARY","PROMPT_CANARY","MANUSCRIPT_CANARY"]
```

也可使用逗号分隔文本。任何 canary 在脱敏后仍存在时，logger 放弃原 payload，只输出 `logging.redaction_failed`。扫描同时覆盖字段名和字段值；API 异常、Worker 作业日志、SSE 事件和 metrics 的指标名、标签名、标签值都在覆盖范围内。

本地验证命令：

```powershell
pnpm exec vitest run packages/core/test/logging.test.ts apps/api/test/app-logger.test.ts apps/api/test/api-exception-filter.test.ts apps/api/test/safe-job-event.test.ts apps/worker/test/safe-logger.test.ts
```

## 诊断路径

1. 使用 request ID、job ID、run ID 和 model call ID 定位。
2. 使用 prompt、ContextPack 和正文哈希确认版本，不复制内容。
3. 在本地使用 deterministic fake provider 复现。
4. 需要供应商排查时，只提供 provider request ID、错误码、时间窗与模型名。
5. 普通日志保留 30 天；超出保留期的日志通过部署环境的日志生命周期策略删除。

本地日志查询：

```powershell
docker compose -f infra/docker/compose.yml logs --since 720h api worker | Select-String "req_|job_|run_|model_call"
```

本地 fake provider 复现：

```powershell
$env:MODEL_CONNECTION_TESTER="fake"
$env:AI_PROVIDER_MODE="fake"
docker compose -f infra/docker/compose.yml up -d --build
```

生产日志驱动必须配置 30 天保留策略。Docker Compose 只提供本地 `--since 720h` 查询，不替代生产日志后端的 retention 配置。

## 指标标签

指标标签通过 `sanitizeTelemetryLabels` 限制为低基数白名单字段，例如 route、method、status、operation、provider、outcome 和 error code。route、job type、provider、method、service 和 queue 只接受已登记值；operation、outcome 和状态只接受低基数机器标识。Worker 作业启动通过 `worker.job.started` 指标路径输出。request ID、用户内容、Prompt、正文、模型自定义名和任意动态字段不得作为指标标签。
