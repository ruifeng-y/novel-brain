# M3-05 安全测试与审计记录

> V1 最终复跑（2026-11-03 03:58 Asia/Shanghai）：在干净
> `novel-brain-v1-acceptance-8f376a5` Compose 项目上执行安全/部署专项，
> 12 files / 43 tests 通过；`pnpm audit --prod --audit-level high` 为 0 high、
> 0 critical、3 moderate。账号级审计、签名下载、吊销会话、生产 TLS/Caddy、
> 脱敏日志和部署配置检查通过；真实 ACME/KMS/SMTP/集中日志/异地灾备证据仍需
> 部署确认。
>
> 原始摘要：`docs/acceptance/m3/security-audit/2026-11-03-v1-rerun-8f376a5.json`。

## 2026-11-02

检查对象：`codex/ticket-32-compliance`，基线提交 `9a4e76d`。

结果：代码级安全检查和自动化验证通过。当前没有 high 或 critical 生产依赖漏洞；存在 3 个 moderate 告警，均来自 MinIO 客户端自带、当前产品未调用的旧版流式通知解析器。部署层面的 TLS、静态加密、操作审计日志和 30 天日志保留仍未闭环，责任人见 `docs/operations/security-checklist.md`。

## 环境

- Windows Docker Desktop，Node.js 24.22.1，pnpm 10.20.0。
- Postgres 16、Redis 7、MinIO、Mailpit。
- API 和 Worker 使用 fake AI provider。
- Playwright Chromium 使用 `http://127.0.0.1:3002`，因为本机 `3000` 端口被另一个工作区占用。

## 自动化结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 静态检查 | `pnpm lint` | 通过，无诊断 |
| 类型检查 | `pnpm typecheck` | 通过，11/11 tasks |
| 安全专项 | `pnpm exec vitest run apps/api/test/security.e2e-spec.ts apps/api/test/security-backup.spec.ts packages/ai/src/redaction.test.ts packages/ai/src/model-key-cipher.test.ts packages/core/src/storage-key.test.ts --maxWorkers=1` | 通过，5 files / 18 tests |
| 全量测试 | `pnpm test` | 通过，31 files / 157 tests |
| 生产构建 | `pnpm build` | 通过，7/7 tasks |
| 完整浏览器验收 | `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm exec playwright test --workers=1` | 通过，30/30 tests，1.2 分钟 |
| 依赖审计 | `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org` | 通过 high 门槛；3 moderate，0 high，0 critical |
| Compose 冒烟 | `AI_PROVIDER=fake docker compose up -d --build --wait postgres redis mailpit minio api worker web` | API 和 Worker 健康，数据库、Redis、对象存储就绪；Web 改用 3002 端口完成验收 |

恢复演练沿用 2026-11-02 已归档记录：数据库恢复 3 秒，低于 4 小时 RTO；备份年龄 52 秒，低于 24 小时 RPO；28/28 个对象逐字节校验一致。

完整 Playwright 在 8 workers 和 4 workers 下各出现一次既有章节生成测试的并发超时；同一测试单独运行 3.6 秒通过，串行全量 30/30 通过。该波动发生在既有写作台测试，不属于本次法律页面，但应作为测试稳定性风险继续跟踪。

## 覆盖点

- 跨作者读取和写入被行级安全策略阻止。
- 全部作者数据表启用并强制行级安全。
- 后台生成任务在作者事务上下文中运行。
- 账号导出限流，且不包含模型 Key 或密文。
- 单章生成限流。
- 模型 Key 信封加密、错误脱敏和存储键前缀隔离。
- 备份路径、恢复库名、对象桶名和内容寻址校验。
- 法律页面不泄露 `Canon`、`ContextPack`、`Agent`、`BYOK`、`RLS`、`信封加密`或`行级安全`等内部术语。
- 法律页面在 390px 移动视口无横向溢出。

## 依赖审计残余风险

`minio@8.0.7` 依赖 `stream-json@1.9.1`，审计报告 3 个 moderate 告警：

- `GHSA-528h-pc64-c93x`：过滤器对深层嵌套输入产生二次复杂度。
- `GHSA-hqr4-qq8f-hg3x`：JSONC 解析器逐块重扫注释。
- `GHSA-mjw6-4jj6-33hc`：Assembler 原型污染。

这些能力位于 MinIO 的桶通知流解析路径。NovelBrain 只调用对象上传、读取、删除和桶检查，不调用 `listenBucketNotification`，也不把用户输入交给 `stream-json`。强制升级到 3.7/3.8 会破坏 MinIO 8.0.7 使用的旧版 `Parser.make()` API，容器启动已验证失败，因此保留兼容版本并把残余风险交给工程负责人跟踪。已用 override 把 `decode-uri-component` 从 0.2.2 提升到 0.5.1，关闭 high 告警；MinIO 加载和完整 Playwright 已复验。

## 原始证据

- `docs/acceptance/m3/security-audit/2026-11-02.json`
- `docs/acceptance/m3/restore-drill.md`
- `docs/acceptance/m3/restore-drill/20261102T120716Z.json`
- `docs/operations/security-checklist.md`
- `docs/operations/content-moderation.md`
- `docs/compliance/legal-pending-items.md`

证据不包含正文、邮箱、模型 Key、密文或对象内容。
