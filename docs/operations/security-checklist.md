# 安全检查清单

本文记录 NovelBrain V1 在 M3-05 的安全检查范围、结果、证据和未闭环事项。检查针对当前 Docker Compose 部署和作者侧功能，不把第三方模型服务自身的控制算作平台已通过。

## 检查信息

| 项目 | 内容 |
| --- | --- |
| 基线提交 | `9a4e76d` |
| 检查日期 | 2026-11-02 |
| 环境 | Windows、Node.js 24.22.1、pnpm 10.20.0、Docker Compose、Postgres 16、Redis 7、Minio、fake AI provider |
| 账号责任人 | 安全与运维负责人 |
| 产品责任人 | 产品负责人 |
| 法务责任人 | 法务负责人 |

## 认证与会话

- [x] 注册验证码 10 分钟过期，最多尝试 5 次，发送按邮箱和 IP 限流。
- [x] 密码使用 Argon2id 哈希，参数为 memory 19,456、time 2、parallelism 1。
- [x] 会话使用 32 字节随机 opaque token，数据库只保存 HMAC-SHA256 摘要。
- [x] 会话 Cookie 为 `httpOnly`、`SameSite=Lax`，生产可通过 `COOKIE_SECURE=true` 启用 Secure。
- [x] 会话 30 天过期，校验时检查撤销状态和账号状态。
- [x] 支持退出当前设备和退出所有设备。
- [x] 登录按邮箱 15 分钟 5 次、按 IP 15 分钟 20 次限流。

证据：`apps/api/src/auth/auth.service.ts`、`apps/api/src/auth/auth.controller.ts`、`apps/api/test/auth.e2e-spec.ts`、`docs/acceptance/m3/security-audit/2026-11-02.json`。

## 授权与数据隔离

- [x] API 请求从登录会话建立作者身份，不信任请求体中的作者 ID。
- [x] 已登录请求在独立事务内设置 `app.user_id`，完成或回滚后清理连接上下文。
- [x] 所有作者数据表启用并强制行级安全。
- [x] 跨作者读取作品和版本点返回 404，不暴露资源存在性。
- [x] Worker 从任务中的作者 ID 建立事务上下文，缺失作者 ID 时失败。
- [x] 对象存储键必须位于作者 UUID 前缀下，拒绝路径穿越、绝对路径和跨作者读取。

证据：`apps/api/src/security/tenant-context.interceptor.ts`、`apps/worker/src/database/database.service.ts`、`packages/core/src/storage-key.ts`、`apps/api/test/security.e2e-spec.ts`。

## 模型凭证

- [x] 每条模型配置使用独立数据密钥，AES-256-GCM 信封加密后保存。
- [x] 主密钥必须为 32 字节，不从数据库读取，不写入导出包。
- [x] 模型配置接口只返回固定掩码，不返回明文或密文。
- [x] 模型错误在落库或进入日志前移除 Bearer Token、`sk-` Key 和常见 Key 字段。
- [x] 账号导出只包含模型配置元数据，不包含 `apiKey` 或 `encryptedApiKey`。

证据：`packages/ai/src/model-key-cipher.ts`、`packages/ai/src/redaction.ts`、`apps/api/src/ai/model-config.service.ts`、`apps/api/src/users/users.service.ts`、`packages/ai/src/model-key-cipher.test.ts`、`packages/ai/src/redaction.test.ts`、`apps/api/test/security.e2e-spec.ts`。

## 依赖与供应链

- [x] 生产依赖审计没有 high 或 critical 告警。
- [x] `decode-uri-component` 通过 pnpm override 固定到 `0.5.1`，关闭 MinIO `query-string` 链上的 high 告警。
- [x] MinIO 在 override 后可以正常加载，API、Worker 和对象存储健康检查通过。
- [ ] `stream-json@1.9.1` 仍有 3 个 moderate 告警，位于未调用的桶通知解析路径。

证据：`docs/acceptance/m3/security-audit.md`、`docs/acceptance/m3/security-audit/2026-11-02.json`、`package.json`、`pnpm-lock.yaml`。

## 导出、日志与对象存储

- [x] 账号导出按作者每小时 3 次限流，超限返回 429 `RATE_LIMITED`。
- [x] 导出响应设置 `Cache-Control: no-store` 和附件下载头。
- [x] 代码库未发现把请求正文、密码或模型 Key 写入应用日志的路径。
- [x] 对象存储写入、读取和删除都先校验作者前缀。
- [x] 备份清单不含正文、邮箱、Key 或密文，恢复演练校验 SHA-256 和对象逐字节一致性。

证据：`apps/api/src/users/users.service.ts`、`apps/api/src/storage/object-storage.service.ts`、`docs/operations/security-backup.md`、`docs/acceptance/m3/restore-drill/20261102T120716Z.json`。

## 备份与恢复

- [x] 每日备份包含 Postgres 和对象存储，保留 30 天。
- [x] 备份 SHA-256、对象数量、字节数、集合校验和写入清单。
- [x] 2026-11-02 恢复演练通过，数据库和对象均恢复并校验。
- [x] 演练记录数据库恢复 3 秒，低于 4 小时 RTO；备份年龄 52 秒，低于 24 小时 RPO。

证据：`docs/acceptance/m3/restore-drill.md`、`docs/acceptance/m3/restore-drill/20261102T120716Z.json`、`apps/api/test/security-backup.spec.ts`。

## 发布前仍需闭环

以下事项不是本次代码测试失败，而是公开运营前必须由对应负责人确认或完成的部署/流程条件。它们不能由“内测可用”替代。

| 项目 | 状态 | 负责人 | 发布门槛 |
| --- | --- | --- | --- |
| 公网 TLS、证书管理和 HSTS | 待部署确认，当前 Caddyfile 仅提供 HTTP | 安全与运维负责人 | 公开访问必须全站 HTTPS，HTTP 重定向到 HTTPS |
| 数据库磁盘、备份介质和对象存储静态加密 | 待部署确认 | 安全与运维负责人 | 生产环境启用磁盘/桶加密并记录密钥轮换方案 |
| 操作审计日志（登录、Key 变更、导出、删除） | 待工程实现或确认 | 工程负责人 | 必须能按作者、动作、目标、时间追溯，日志不含正文和 Key |
| 日志 30 天保留与访问控制 | 待部署确认 | 安全与运维负责人 | 生产日志平台配置保留期、访问审计和脱敏验证 |
| 对象下载签名链接 | 当前由 API 校验作者后读取，未使用签名链接 | 工程负责人 | 若改为直连对象存储，必须使用短时签名链接并限制作者前缀 |
| 生产环境默认数据库密码 | 已由启动检查阻止，开发 Compose 显式允许 | 安全与运维负责人 | 生产设置强密码并删除 `ALLOW_DEFAULT_DB_PASSWORD` |
| MinIO 旧版 `stream-json` 的 3 个 moderate 告警 | 当前产品未调用桶通知解析路径；强制升级会破坏 MinIO 8.0.7 的旧 API | 工程负责人 | 跟踪 MinIO 上游修复；启用桶通知前必须清除 |

## 结论

本次代码级安全检查通过，数据库、Redis 和对象存储集成测试有可重复证据。公开运营前必须关闭上表的部署和审计事项；在这些事项完成前，不应把当前 Compose 配置当作公网生产配置。
