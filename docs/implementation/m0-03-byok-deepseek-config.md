# M0-03 BYOK DeepSeek 配置与连接测试

> Issue: #69
> Capability IDs: ACCT-007, ACCT-008, SEC-001
> UI parity matrix: account-settings

## 实现范围

- DeepSeek 官方 Provider 和显式 OpenAI 兼容白名单。
- API Key 使用 AES-256-GCM 加密落库，响应只返回稳定掩码。
- Base URL 强制 HTTPS，并拒绝回环、私网、链路本地地址和未授权 Provider。
- 连接测试区分成功、Key 无效、Provider 限流、超时和 Provider 错误。
- 连接失败返回稳定的 `MODEL_*` 错误码，不把失败结果包装成成功响应。
- 模型配置路径参数使用共享 Zod UUID 契约校验。
- 创建接口按用户、路径和幂等键返回同一结果；幂等结果保留 24 小时，并发请求在用户锁内复查。
- 删除采用软删除，立即从作者列表移除，同时保留 24 小时幂等重试结果；最后一个配置不可删除。
- 模型配置支持规划、正文和检查用途；`/workspace/settings` 重定向到账号设置页。
- 模型 Key 创建、更新和删除写入不含敏感内容的审计记录，包含 IP、User-Agent 和 correlation ID。
- 所有模型配置查询和修改按当前用户隔离。
- `/workspace/settings/account` 支持新增、编辑、测试和删除模型配置，并覆盖加载、错误、禁用、权限、部分失败和限流状态。

## 验证结果

- `pnpm check`：25 个单元/契约测试通过。
- `pnpm test:integration`：9 个真实 PostgreSQL/Redis HTTP 集成测试通过。
- `pnpm test:e2e`：18 个真实 API Playwright 测试通过。
- 集成测试确认数据库密文不包含明文 Key，API 响应不包含明文 Key。
- 跨用户读取、测试和删除模型配置均被拒绝。
- HTTP、回环、私网、链路本地 IPv4/IPv6 等 SSRF 目标被拒绝。
- API Key 使用信封加密；创建接口支持 `Idempotency-Key`，并保持至少一个默认配置。
- 审计测试确认 Key 创建、更新和删除记录 actor、action、target、decision、correlation ID、IP 和 User-Agent。

## 边界

- 真实 DeepSeek smoke 由 #79 的独立 gated 测试执行；普通测试使用确定性 fake connection tester。
- 生产 golden 仍需按 ADR 0027 在作者签收后创建。
