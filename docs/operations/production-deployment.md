# 生产部署安全加固

本文面向 NovelBrain 生产部署，说明 TLS/HSTS、Cookie、静态加密、签名下载、SMTP、
日志保留、异地备份和部署验收。生产入口使用 `docker-compose.production.yml` 覆盖
本地 `docker-compose.yml`；本地开发仍使用 HTTP、Mailpit 和开发密钥。

## 生产拓扑

- `caddy` 是唯一公网入口，自动申请和续期 TLS 证书，HTTP 自动重定向到 HTTPS。
- `web`、`api`、`worker`、`postgres`、`redis`、`minio` 只在 Compose 内网暴露。
- `mailpit` 带 `local` profile，生产启动默认不创建。
- 生产 Compose 使用 `json-file` 日志轮转；Caddy 访问日志单独保留 30 天。
- Postgres、Redis、MinIO 和备份目录必须放在已加密的磁盘或云卷上。

## 首次部署

1. 准备域名并让 A/AAAA 记录指向主机，放行 80/443。
2. 复制 `.env.production.example` 到仓库外的受限文件，例如
   `/etc/novel-brain/production.env`。
3. 生成独立随机密钥：

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # DOWNLOAD_SIGNING_SECRET
openssl rand -base64 32   # MODEL_KEY_ENCRYPTION_KEY
```

4. 设置强数据库、Redis、MinIO 和 SMTP 凭证。`DATABASE_URL` 必须使用受限
   `novel_app` 角色，不能使用数据库所有者。
5. 确认数据库盘、对象存储桶和备份目标已启用静态加密，再设置
   `ENCRYPTION_AT_REST_CONFIRMED=true`。
6. 至少完成一次异地备份和恢复核对，再设置 `OFFSITE_BACKUP_CONFIRMED=true`。
7. 运行静态检查：

```bash
pnpm build
pnpm deploy:check
pnpm deploy:smoke
pnpm deploy:verify --env-file /etc/novel-brain/production.env
```

`deploy:check` 校验 Compose/Caddy 和运行手册；`deploy:smoke` 用临时 Docker 网络启动
生产 Caddy，验证 HTTPS、HSTS、HTTP 重定向和签名路径日志脱敏；`deploy:verify`
读取真实环境文件并校验 Compose 生成的 API/Worker 有效环境。

8. 启动：

```bash
docker compose \
  --env-file /etc/novel-brain/production.env \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  up -d --build --wait
```

API 容器先执行迁移和 seed，再用 `DATABASE_ADMIN_URL` 把 `novel_app` 角色密码同步为
`DATABASE_URL` 中的值，最后启动 API。这样全新卷首次部署也能使用轮换后的应用角色
密码；命令不会打印密码。

## TLS 与 HSTS

`infra/caddy/Caddyfile.production` 使用 `{$APP_DOMAIN}` 自动签发证书，证书和账户
数据保存在 `caddy-data` 卷。响应包含：

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

上线前先用测试域名确认证书续期和 DNS。不要在证书尚未稳定时提交 HSTS preload；
当前策略未包含 `preload`。

应用只信任一层反向代理（`TRUST_PROXY_HOPS=1`）。如果前面还有 CDN 或负载均衡，
按实际代理层数调整，否则限流 IP 会取错。

## Cookie 与下载

- 生产 `COOKIE_SECURE=true`，会话 Cookie 同时保持 `HttpOnly`、`SameSite=Lax`。
- `WEB_URL` 必须是 HTTPS；生产启动检查会拒绝 HTTP、短密钥和开发密钥。
- 导出下载使用 HMAC-SHA256 签名链接，默认 300 秒过期，最长 900 秒。
- 签名绑定作者、作品、分支和导出版本；下载链接视为短期凭证，不要转发或在工单、
  聊天或报表中粘贴。
- Caddy 和 API 日志会把 `/downloads/<token>` 替换为 `/downloads/[REDACTED]`。
- 旧的登录态下载接口保留给 API 客户端；页面使用签名链接。

## Encryption at rest

应用无法远程证明云盘或对象桶已经加密，因此生产启动要求显式配置确认：

- Postgres 数据卷和数据库备份：LUKS、BitLocker、云盘加密或等价控制。
- MinIO/S3 桶：服务端加密和受控 KMS 密钥；轮换密钥时保留旧数据解密能力。
- 备份目标：目标盘/桶加密；异地传输使用 TLS。
- `MODEL_KEY_ENCRYPTION_KEY` 只存于密钥管理系统或受限环境文件，不进入备份、
  日志、工单或镜像。轮换前必须先回写所有模型 Key，再切换主密钥。
- `ENCRYPTION_AT_REST_CONFIRMED=true` 是运维确认，不是应用自动检测。发布证据应
  记录卷 ID、桶策略、KMS 密钥和检查日期，不记录密钥本身。

## 生产 SMTP

生产必须使用外部 SMTP relay，配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、
`SMTP_PASSWORD` 和公开域名 `SMTP_FROM`。

- 587 端口通常使用 `SMTP_SECURE=false`、`SMTP_REQUIRE_TLS=true`。
- 465 端口通常使用 `SMTP_SECURE=true`。
- 生产启动拒绝 Mailpit/localhost、`.local` 发件人、无认证和关闭 TLS 校验。
- `SMTP_REJECT_UNAUTHORIZED=true` 必须保持开启；不要把企业自签证书直接绕过，
  应把 CA 加入信任链。

## 日志保留与脱敏

详细策略见 `docs/operations/log-retention.md`。生产默认：

- API 和 Worker 输出 JSON；消息、Cookie、Authorization、密码、API Key、签名和
  下载 token 在写出前脱敏。
- Caddy 访问日志写入 `caddy-logs` 卷，单文件 100 MiB，最多 10 个滚动文件，
  最长保留 `720h`（30 天）。
- Docker stdout 日志按 100 MiB × 10 轮转。
- 若使用集中日志平台，必须设置 30 天保留、最小权限访问、访问审计和删除流程。

启动检查要求 `LOG_FORMAT=json`、`LOG_RETENTION_DAYS>=30`，但这些变量不能替代
日志平台配置。

## Offsite backup

每日本地备份：

```bash
node scripts/ops.mjs backup
```

把最新快照复制到独立磁盘、NAS 或已挂载的版本化对象存储：

```bash
node scripts/ops.mjs offsite \
  --backup backups/postgres/20261103T030000Z \
  --target /mnt/novel-brain-offsite/postgres
```

命令会复制完整快照，写入 `offsite-manifest.json`，记录每个文件的 SHA-256 和整棵
目录校验和。目标已存在时拒绝覆盖；目标不能位于源备份目录内。

使用 rclone 同步到异地 S3 兼容桶：

```bash
rclone sync backups/postgres/20261103T030000Z \
  remote:novel-brain-offsite/postgres/20261103T030000Z \
  --immutable --checksum
```

使用 AWS CLI：

```bash
aws s3 sync backups/postgres/20261103T030000Z \
  s3://novel-brain-offsite/postgres/20261103T030000Z \
  --sse aws:kms --only-show-errors
```

备份包含加密后的模型 Key 密文，仍应按生产数据保护。若目标不提供静态加密，先在
受控主机上使用 `age` 或等价工具加密，再上传密文。

恢复核验：

```bash
node scripts/ops.mjs restore-drill \
  --backup /mnt/novel-brain-offsite/postgres/20261103T030000Z \
  --verify-key <uploaded-object-key>
```

只有异地副本参与恢复演练成功后才能设置 `OFFSITE_BACKUP_CONFIRMED=true`。

## 无法在本机证明的云项目

以下项目需要真实云/主机证据，不能由本地 Compose 测试替代：

- 公网 DNS、ACME 证书签发、自动续期和 CDN/代理链。
- 云盘、云数据库、对象桶和异地桶的实际静态加密与 KMS 策略。
- 生产 SMTP 投递、退信、SPF/DKIM/DMARC 和供应商 TLS 证书链。
- 集中日志平台的 30 天保留、访问审计、导出和删除。
- 异地备份跨区域复制、离线副本、真实灾难切换和恢复时间。
- 主机补丁、防火墙、WAF、DDoS、密钥管理服务和值班告警。
