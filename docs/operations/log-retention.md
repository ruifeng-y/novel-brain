# 日志保留与脱敏

生产日志以“只记录运行所需元数据”为原则。请求正文、密码、验证码、模型 Key、
会话 Cookie、Authorization 头和签名下载 token 不得进入日志。

## 应用日志

- API 和 Worker 使用共享 `RedactingLogger`。
- 生产 `LOG_FORMAT=json`，每条记录包含时间、级别、服务和可选上下文。
- 对象字段名包含 `password`、`secret`、`token`、`cookie`、`authorization`、
  `signature`、`apiKey` 或 `credential` 时整体替换为 `[REDACTED]`。
- 文本中的 Bearer Token、`sk-` Key、键值凭证、查询参数和
  `/downloads/<token>` 路径会被替换。
- Nest 默认请求体日志未启用；不要通过调试中间件记录原始请求。

生产启动要求 `LOG_FORMAT=json`、`LOG_RETENTION_DAYS>=30`。

## Caddy 访问日志

`infra/caddy/Caddyfile.production` 将访问日志写入 `caddy-logs` 卷：

- `roll_size 100MiB`
- `roll_keep 10`
- `roll_keep_for 720h`
- 删除 Cookie、Authorization 和 Set-Cookie 字段
- 签名下载路径替换为 `/downloads/[REDACTED]`

检查日志轮转：

```bash
docker compose \
  --env-file /etc/novel-brain/production.env \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  exec caddy ls -lh /var/log/caddy
```

## 集中日志平台

如需长期检索和审计，把 Docker/Caddy 日志转发到受控平台，并配置：

- 保留期至少 30 天，删除流程和法务保留例外有记录。
- 只有安全与运维负责人可读，查询和导出有审计。
- 传输使用 TLS，平台侧静态加密。
- 入库前再执行一次脱敏；不要把签名 token 当作可检索字段。
- 告警只包含作者内部 ID、动作和错误码，不包含正文、邮箱或 Key。

## 本地验证

```bash
pnpm exec vitest run packages/core/src/logging.test.ts --maxWorkers=1
pnpm deploy:check
```

部署后可用一条带假 token 的请求确认 Caddy 日志不保留原路径：

```bash
curl -k -H "Host: $APP_DOMAIN" "https://127.0.0.1/api/v1/downloads/test-token-value"
docker compose exec caddy tail -n 20 /var/log/caddy/access.log
```

预期日志中出现 `/api/v1/downloads/[REDACTED]`，不出现 `test-token-value`。
