# M3-03b 日志脱敏、追踪边界与安全证据扫描

> Issue: #133  
> Capability: SEC-003  
> Status: implementation complete

## 1. 实现范围

- 扩展 `packages/core/src/logging.ts`：普通日志与结构化响应分别使用显式字段白名单，敏感键统一脱敏，未登记字段（包括数字、布尔和 null）一律移除。
- 普通日志只输出 ID、哈希、长度、状态、错误码、模型与成本等非敏感字段。
- API 和 Worker 都通过安全 logger 写普通日志；canary 在脱敏后仍存在时丢弃原 payload，仅输出 `logging.redaction_failed`。
- API 异常响应和 SSE job event 在返回前经过同一敏感载荷过滤。
- API 异常的 Zod `path` 只保留字段标识符，自由文本、未知字段和不可识别路径段被移除。
- API 错误顶层文案保持服务端编写的作者提示，凭据或 canary 命中时按状态降级；详情只保留机器诊断值。Worker readiness CLI 的失败日志也经过统一安全 logger。
- 新增 trace policy 与启动 trace sink：默认关闭；`self_hosted` 必须显式配置保留期与自托管 HTTP(S) endpoint，启动时导出只含安全属性的 `service.started` envelope，失败则启动失败。
- trace 名称、时间和属性执行格式与 canary 校验；endpoint 拒绝公开 IPv6，导出请求禁止跟随重定向。
- 新增低基数 metrics label 白名单过滤；Worker 作业启动使用真实 `worker.job.started` 指标日志路径。

## 2. 验收证据

- `packages/core/test/logging.test.ts`
  - Key、manuscript、prompt、ContextPack、imported source 和 chapter body 别名脱敏。
  - canary 残留时 fail-closed。
  - canary 出现在字段名时同样 fail-closed。
  - trace off/self-hosted、保留期、自托管 endpoint 校验和 trace 导出 body。
  - trace 名称和时间 canary、公网 IPv6 拒绝和禁止重定向。
  - metrics 指标名、标签名和标签值均执行 canary/credential 扫描，并丢弃敏感字段与高基数字段。
- `apps/api/test/app-logger.test.ts`
  - API 普通日志 canary 扫描。
  - logger context 不泄露 canary。
  - payload、context 或 stack 脱敏失败只输出固定错误事件。
- `apps/worker/test/safe-logger.test.ts`
  - Worker 普通日志 canary 扫描。
  - Key、manuscript、prompt、未知字段和 header 分别验证不泄露。
  - metrics label 生产路径丢弃 request ID、动态 route 和自定义模型名。
  - 安全 ID 和作业类型仍可用于诊断。
- `apps/api/test/api-exception-filter.test.ts`
  - 错误响应不返回 Key、prompt 或正文。
  - 未处理错误日志不包含异常原文。
- `apps/api/test/safe-job-event.test.ts`
  - SSE event ID 与错误码保留，敏感 payload 被移除。

## 3. 运维边界

诊断与追踪操作规范见 `docs/operations/logging-and-tracing.md`。

- 普通日志保留 30 天，由部署环境日志生命周期策略执行。
- 第三方追踪默认关闭。
- 自托管追踪通过 `TRACE_MODE=self_hosted`、`TRACE_RETENTION_DAYS` 和 `TRACE_ENDPOINT` 显式启用。
- 诊断只使用 request/job/run/model-call ID、哈希、错误码和 provider request ID，不复制正文或 Prompt。
