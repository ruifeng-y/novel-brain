# 日志与追踪运维边界

## 普通日志

普通日志只允许记录：

- request ID、job ID、run ID、model call ID、reservation ID 和审计 correlation ID。
- Prompt、ContextPack 与正文的哈希、长度和引用 ID。
- Provider、模型名、状态、错误码、耗时、token 与费用。
- 不含用户内容的低基数指标标签。

普通日志不得记录 API Key、authorization header、正文、完整 prompt、ContextPack 快照、导入原文或其他用户私有内容。

## 追踪

追踪默认关闭。自托管追踪必须同时配置：

```text
TRACE_MODE=self_hosted
TRACE_RETENTION_DAYS=<1-365>
TRACE_ENDPOINT=<http(s) endpoint>
```

只设置 endpoint 或 retention、但不显式设置 `TRACE_MODE=self_hosted` 时，API/Worker 应启动失败。追踪策略在启动日志中只记录 mode、retention 和 endpoint 是否已配置，不记录 endpoint 本身。

## 脱敏 canary

部署扫描可以设置：

```text
LOG_CANARY_VALUES=["KEY_CANARY","PROMPT_CANARY","MANUSCRIPT_CANARY"]
```

也可使用逗号分隔文本。任何 canary 在脱敏后仍存在时，logger 放弃原 payload，只输出 `logging.redaction_failed`。canary 扫描应覆盖 API 异常、Worker 作业日志和 SSE 事件。

## 诊断路径

1. 使用 request ID、job ID、run ID 和 model call ID 定位。
2. 使用 prompt、ContextPack 和正文哈希确认版本，不复制内容。
3. 在本地使用 deterministic fake provider 复现。
4. 需要供应商排查时，只提供 provider request ID、错误码、时间窗与模型名。
5. 普通日志保留 30 天；超出保留期的日志通过部署环境的日志生命周期策略删除。

## 指标标签

指标标签通过 `sanitizeTelemetryLabels` 限制为低基数白名单字段，例如 route、method、status、operation、provider、model、outcome 和 error code。request ID、用户内容、Prompt、正文和任意动态字段不得作为指标标签。
