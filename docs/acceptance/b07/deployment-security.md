# B-07 生产部署安全加固验收

> 日期：2026-11-03  
> 分支：`codex/b07-deploy-hardening`  
> 基线：`592dacb`  
> 结论：代码、配置、自动化冒烟通过；真实云、域名、邮件和集中日志证据仍需部署确认。

## 交付范围

- TLS 自动签发、HTTP→HTTPS 重定向、HSTS 和安全响应头。
- 生产 Cookie 强制 Secure、HttpOnly、SameSite=Lax。
- 生产静态加密确认检查、备份/对象存储静态加密和密钥轮换运行手册。
- 300–900 秒 HMAC 签名导出下载链接，绑定作者、作品、分支和导出记录。
- 生产 SMTP 认证、TLS、证书校验和公开发件人检查。
- Caddy 访问日志 30 天滚动、Cookie/Authorization/签名路径脱敏。
- API/Worker JSON 日志和递归字段/文本脱敏。
- 生产 Compose/Caddy 覆盖、环境文件示例、启动检查和 CI 部署冒烟。
- offsite 备份复制、逐文件 SHA-256 清单和恢复核对命令。

## 自动化结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 静态检查 | `pnpm lint` | 通过 |
| 类型检查 | `pnpm typecheck` | 通过，13/13 tasks |
| 全量测试 | `pnpm test` | 通过，49 files / 229 tests |
| 安全专项 | 安全、下载、备份、日志、环境、部署配置 9 files | 通过，33 tests |
| 导出 API | `apps/api/test/exports.e2e-spec.ts` | 通过，6/6 tests |
| 部署配置与环境专项 | 7 files | 通过，24 tests |
| 数据库角色引导 | `db-bootstrap.spec.ts` + 全新 Postgres 容器 | 通过，3 tests；迁移后角色密码同步并以 `rotated'app@pass` 连接成功 |
| 生产构建 | `pnpm build` | 通过，8/8 tasks |
| 生产配置检查 | `pnpm deploy:check` | Compose/Caddy/runbook PASS |
| 生产环境检查 | `pnpm deploy:verify --env-file <smoke-env>` | API/Worker effective env PASS |
| Caddy 运行时冒烟 | `pnpm deploy:smoke` | HTTPS、HSTS、HTTP redirect、下载路径/Cookie/Authorization 日志脱敏 PASS |
| 依赖审计 | `pnpm audit --prod --audit-level high` | 0 high / 0 critical / 3 moderate（既有 MinIO 链） |

## 验收映射

| Issue #37 范围 | 实现与证据 |
| --- | --- |
| TLS/HSTS 和 Secure Cookie | `docker-compose.production.yml`、`infra/caddy/Caddyfile.production`、`session-cookie.spec.ts`、`env.test.ts`、`deploy:smoke` |
| 静态加密 | `ENCRYPTION_AT_REST_CONFIRMED` 启动门槛、`docs/operations/production-deployment.md`、生产 runbook；真实云证据未验证 |
| 签名/过期下载 | `packages/core/src/download-token.test.ts`、`downloads.controller.ts`、`exports.e2e-spec.ts`、Caddy 路径脱敏 |
| 生产 SMTP | `smtp-options.spec.ts`、生产 env 校验、Nodemailer TLS/证书配置；真实投递未验证 |
| 异地备份 | `scripts/offsite-backup.mjs`、`ops.mjs offsite`、`security-backup.spec.ts`、运行手册；真实异地恢复未验证 |
| 日志保留/脱敏 | `packages/core/src/logging.test.ts`、`RedactingLogger`、Caddy `roll_keep_for 720h`、`deploy:smoke` |
| 生产 Compose/Caddy 覆盖 | `docker-compose.production.yml`、`infra/caddy/Caddyfile.production`、`.env.production.example`、`deployment-config.spec.ts` |
| env 校验 | `packages/contracts/src/env.test.ts`、`packages/contracts/src/env.ts`、`deploy:verify` |
| 全新生产库首次启动 | API 容器先迁移/seed，再同步 `novel_app` 密码；`ensure-app-role-password.mjs` + 一次性 Postgres 验证 |
| 不破坏本地开发 | 基础 Compose 仍为 development/HTTP/Mailpit；开发环境跳过生产严格检查 |

## 运行环境

- Windows、Node.js 24.22.1、pnpm 10.20.0、Docker 29.7.2、Compose v5.5.0。
- API 集成测试使用本机标准端口的 Postgres 16、Redis 7、Mailpit 和 MinIO。
- Caddy 冒烟使用临时 Docker 网络、动态主机端口和临时内部证书。
- 本分支未新增数据库迁移，无需重编号。

## 未验证与残余风险

- 真实公网 DNS、ACME 签发/续期、CDN/负载均衡代理层和证书轮换。
- 云盘、云数据库、对象桶和 KMS 的实际静态加密与密钥轮换。
- 生产 SMTP 供应商投递、SPF/DKIM/DMARC、退信和证书链。
- 集中日志平台 30 天保留、访问审计、导出和删除。
- 异地对象存储复制、离线副本、真实灾难切换和 RTO/RPO。
- 签名下载 token 在有效期内可重放；已通过短 TTL、绑定范围和日志脱敏降低风险。
- `ENCRYPTION_AT_REST_CONFIRMED` 和 `OFFSITE_BACKUP_CONFIRMED` 是运维确认，不是应用自动探测。
