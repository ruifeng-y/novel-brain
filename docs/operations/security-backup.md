# 数据安全与备份运维

本文面向部署运维，说明账号数据隔离、模型 Key 保护、接口限流、备份恢复和恢复演练。作者界面只使用“模型配置”“导出”等作者语言，不展示数据库策略、密钥信封或内部服务名。

## 运行角色

应用不再使用数据库所有者连接：

- `DATABASE_ADMIN_URL`：只用于迁移、种子和备份恢复。
- `DATABASE_URL`：API 与 Worker 使用受限角色 `novel_app`，所有业务查询受行级安全策略约束。
- `MODEL_KEY_ENCRYPTION_KEY`：模型 Key 的主密钥。只放在密钥管理系统或受限环境变量中，不写进备份目录、日志或工单。

如果轮换 `novel_app` 密码：

```sql
alter role novel_app password '<new-password>';
```

然后同步更新 API 和 Worker 的 `DATABASE_URL`。不要改成数据库所有者角色，否则行级安全会被绕过。

## 隔离边界

- API 的已登录请求在事务中设置 `app.user_id`，请求结束前提交或回滚。舱壁式事务不会把租户上下文遗留在连接池里。
- Worker 从队列中的作者 ID 建立同样的事务上下文。缺少作者 ID 的生成任务会失败，不会无上下文执行。
- 账号、会话、模型配置、作品、分支、正史、大纲、章节、任务、地图和修改记录均启用并强制行级安全。
- 认证流程只在标记为认证上下文的事务内读取账号和验证码；不会借此读取作品正文。
- 对象存储键只能由 `userStorageKey` 生成，并以作者 UUID 开头。读取和删除同样校验前缀，`..`、绝对路径和跨作者键会被拒绝。

## 模型 Key 保护

- 每条模型配置生成独立数据密钥，数据密钥再被主密钥包裹，使用 AES-256-GCM 信封加密。
- 旧版 `v1` 密文仍可解密，新写入统一为 `v2`。
- API 永远只返回掩码和配置元数据，不返回明文或密文。
- 模型供应商错误在写入任务状态或日志前经过脱敏，Bearer Token、`sk-` Key 和常见 Key 字段会被替换为 `[REDACTED]`。
- 运维 CLI 没有读取或打印模型 Key 的命令。备份中包含的是加密后的密文，不能当作明文凭证使用。

## 接口限流

限流使用 Redis，按窗口计数：

| 接口 | 限制 |
| --- | --- |
| 登录 | 同一邮箱 15 分钟 5 次，同一 IP 15 分钟 20 次 |
| 邮箱验证码 | 同一邮箱每分钟 1 次、每天 10 次；同一 IP 每分钟 1 次 |
| 账号导出 | 每作者每小时 3 次 |
| 单章生成 | 每作者每分钟 10 次 |
| 批量生成 | 每作者每分钟 5 次 |
| 找回密码 | 与验证码流程共用邮箱和 IP 限流 |

触发限流返回 HTTP 429 和 `RATE_LIMITED`，不会创建导出文件、生成请求或后台任务。

## 每日备份

备份命令：

```bash
node scripts/ops.mjs backup
```

默认行为：

- 通过 Docker Compose 的 `postgres` 服务执行 `pg_dump`。
- 使用一个导出的 Postgres 快照同时生成备份和行数清单，避免备份过程中并发写入造成校验偏差。
- 输出到 `backups/postgres/<UTC 时间>/`，包含 `database.pgcustom` 和 `manifest.json`。
- `manifest.json` 记录创建时间、SHA-256、字节数和作者、作品、章节、任务行数。
- 自动删除超过 30 天的备份，保留窗口可通过 `--retention-days` 调整。
- 备份目录已加入 `.gitignore`，不得提交到仓库。

每日 03:00 执行示例：

```cron
0 3 * * * cd /srv/novel-brain && node scripts/ops.mjs backup >> /var/log/novel-brain-backup.log 2>&1
```

Windows 计划任务只运行：

```powershell
node D:\AI\Codex\novel-brain\scripts\ops.mjs backup
```

将 `backups/` 同步到独立磁盘、NAS 或启用版本控制的对象存储。只保留主机本地副本不满足容灾要求。

备份目标：

- RPO 24 小时：每日至少成功一次备份。
- RTO 4 小时：恢复演练持续记录，超过 4 小时视为失败。
- 保留 30 天：超过窗口的备份由 CLI 自动清理。

## 恢复

恢复必须指向临时数据库，避免覆盖在线库：

```bash
node scripts/ops.mjs restore \
  --backup backups/postgres/20261102T110239Z \
  --target-db novel_restore_drill_20261102110244 \
  --drop-existing
```

CLI 会先校验 `manifest.json` 中的 SHA-256，再创建空数据库并执行 `pg_restore`。恢复目标必须匹配 `novel_restore_drill_*`，且不能是 `novel`。

正式切换前：

1. 在临时库完成恢复和行数核对。
2. 运行迁移，确认 `drizzle.__drizzle_migrations` 与发布版本一致。
3. 停止 API 与 Worker，保留原库快照。
4. 将 `DATABASE_URL` 和 `DATABASE_ADMIN_URL` 指向恢复库。
5. 启动服务并执行健康检查、登录、作品读取和单章生成冒烟测试。
6. 失败时切回原库，不删除原库。

在新集群恢复时，先执行数据库迁移以创建 `novel_app` 角色、策略和授权，再恢复数据。

## 恢复演练

```bash
node scripts/ops.mjs restore-drill --backup backups/postgres/20261102T110239Z
```

演练会：

- 校验备份校验和。
- 创建隔离数据库并完整恢复。
- 比较源快照和恢复库的账号、作品、章节、章节版本和任务行数。
- 检查备份年龄不超过 24 小时、恢复耗时不超过 4 小时。
- 写入 `docs/acceptance/m3/restore-drill/<时间>.json`，不包含正文、邮箱、Key 或密文。
- 默认删除临时库；排查时加 `--keep`。

演练失败时不要删除旧备份，也不要执行正式切换。
