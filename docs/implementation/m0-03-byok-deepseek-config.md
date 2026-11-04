# M0-03 BYOK DeepSeek 配置与连接测试

> Issue: #69
> Capability IDs: ACCT-007, ACCT-008, SEC-001
> UI parity matrix: account-settings

## 实现范围

- DeepSeek 官方 Provider 和显式 OpenAI 兼容白名单。
- API Key 使用 AES-256-GCM 加密落库，响应只返回稳定掩码。
- Base URL 强制 HTTPS，并拒绝回环、私网、链路本地地址和未授权 Provider。
- 连接测试区分成功、Key 无效、Provider 限流、超时和 Provider 错误。
- 所有模型配置查询和修改按当前用户隔离。
- `/workspace/settings/account` 支持新增、编辑、测试和删除模型配置。

## 验证结果

- `pnpm check`：17 个单元/契约测试通过。
- `pnpm test:integration`：8 个真实 PostgreSQL/Redis HTTP 集成测试通过。
- `pnpm test:e2e`：13 个真实 API Playwright 测试通过。
- 集成测试确认数据库密文不包含明文 Key，API 响应不包含明文 Key。
- 跨用户读取、测试和删除模型配置均被拒绝。
- `https://127.0.0.1` 等 SSRF 目标被拒绝。

## 边界

- 真实 DeepSeek smoke 由 #79 的独立 gated 测试执行；普通测试使用确定性 fake connection tester。
- 生产 golden 仍需按 ADR 0027 在作者签收后创建。
