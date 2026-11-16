# 运维告警与响应手册

`infra/observability/alert-thresholds.json` 是默认审查阈值，`alerts.yml` 是 Prometheus 规则，`fixtures/` 保存可复现的故障样例。阈值是操作审查线，不等同于已通过容量或 SLA 证明。

本 runbook 由 `scripts/observability-guardrails.mjs` 校验：每个 alert 必须有规则、阈值和对应处置标题。生产阈值变更必须同步更新 fixture 与本文件。

## ApiReadinessDown

API 抓取失败或任一必需依赖不可用时持续 2 分钟触发，避免单次探针抖动。先检查 `/api/v1/health` 与 `/api/v1/health/ready`，再用 request ID 和依赖检查结果定位数据库、队列或对象存储。

## ApiLatencyHigh

API p95 超过 300ms 并持续 10 分钟触发。该阈值来自 V1 CRUD p95 目标。检查请求路由、数据库慢查询和运行时资源。

## WorkerQueueBacklog

等待队列超过 20 个任务并持续 10 分钟触发。20 个任务按单机全局 4 并发、单章 5 分钟目标估算为多个完整处理周期；这是初始审查线，需由真实吞吐数据校准。检查 Worker 数量、失败重试和 Redis 可用性，不查看正文或 Prompt。

## WorkerQueueOldestJobAge

最老等待任务排队超过 300 秒触发，对应单章 5 分钟目标；正在执行的长任务不参与该告警。确认 Worker 消费能力、暂停状态和步骤检查点后再决定扩容或恢复。

## JobFailureRateHigh

最近 24 小时最终结果为失败的任务占比超过 10% 并持续 15 分钟触发；中间重试尝试不计入最终任务结果。10% 是正式 beta 前的初始审查线，不替代 #137 的容量证据。按错误码、任务类型和检查点定位，禁止把正文或 Prompt 复制到告警。

## ModelLatencyHigh

全部模型调用的完整请求耗时按调用数加权平均后超过 5000ms 并持续 10 分钟触发。该线是上游完整调用预算，不代表首 token（TTFT）目标。检查 Provider 状态、限流和模型配置；重试必须遵守既有预算与幂等规则。

## ModelCostDailyHigh

最近 24 小时模型费用超过 20 元触发。20 元是默认异常审查线，不替代作者或任务预算；核对预算、实际 token 与失败计费，不修改作者数据。

## StorageUsageHigh

MinIO 可用容量低于 15% 并持续 30 分钟触发。15% 保留清理和恢复操作余量，不承诺容量 SLA。确认容量、保留策略和孤儿对象；清理必须走审计与 dry-run。

## StorageUnavailable

对象存储健康检查失败。检查 MinIO 容器、磁盘与网络；恢复前不要批准导出、备份或删除任务。
