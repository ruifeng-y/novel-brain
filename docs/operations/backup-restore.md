# 备份、恢复与 RPO/RTO

> Issue: #136
> Capabilities: OPS-002, IO-007
> Status: operational runbook

## 1. 目标与边界

- 每日至少一次全量备份，目标 RPO 24h、RTO 4h。目标是待持续测量项，单次 drill 不等于生产 SLA。
- 备份覆盖 Postgres、MinIO 对象、对象清单、schema migration 元数据和密钥指纹。
- 数据库正文、账号资料和对象内容只以 AES-256-GCM 密文保存。明文工作文件在加密后立即删除。
- 默认保留 30 days；账号注销的 `backupExpiresAt` 不得晚于该保留边界。
- 备份完成前不产生 `completion.json`。缺少该文件、manifest 哈希不一致或 checksum 不一致的目录一律不可恢复。

## 2. 密钥与访问控制

备份密钥是 32 字节随机值的 canonical base64。优先放在宿主机 secret manager，并通过 `--key-file` 读取；也可以设置 `BACKUP_ENCRYPTION_KEY_BASE64`。

- manifest 只保存 AES-256-GCM 算法和 key fingerprint，不保存密钥或明文应用 secret。
- 密钥丢失会使对应备份不可恢复；密钥轮换时必须保留旧密钥直到旧备份过期。
- 备份目录、密钥和恢复主机只授予运维角色。不要把备份目录放进公开对象桶或普通日志。
- `BACKUP_ENCRYPTION_KEY_BASE64` 不注入 Web/API/Worker 容器，只供宿主机备份脚本使用。

## 3. 一致性快照

Postgres 使用 custom-format `pg_dump`；MinIO 使用 `mc mirror --preserve`。manifest 固化表级精确行数、FK 约束、对象 key/size/SHA-256、对象引用和 migration 文件 checksum。

MinIO 没有跨数据库事务。完整生产备份必须在维护窗口内先停止 API/Worker 写入，或由未来的 advisory lock 写入门禁保证业务写入暂停；doctor 脚本会拒绝没有 `completion.json` 的中断备份。恢复前不得把备份目录复制回生产并覆盖现有 volume。

对象与数据库的引用由 `infra/backup/object-references.json` 登记。新增对象存储列时，同一变更必须更新该登记；当前覆盖 `users.avatar_url` 和 `pen_names.avatar_url`。

## 4. 创建与验证

在仓库根目录使用原生 PowerShell：

```powershell
$env:BACKUP_ENCRYPTION_KEY_BASE64 = (Get-Content -Raw C:\secure\novelbrain-backup.key).Trim()
pnpm backup:create -- --project novel-brain-m0 --output D:\backups\novelbrain
pnpm backup:verify -- --backup D:\backups\novelbrain\<backup-id> --key-file C:\secure\novelbrain-backup.key
```

生产计划任务每天调用同一 `pnpm backup:create` 命令。先 dry-run，再按保留策略清理：

```powershell
pnpm backup:prune -- --directory D:\backups\novelbrain
pnpm backup:prune -- --directory D:\backups\novelbrain --apply
```

`backup:prune --apply` 只删除到期完整备份和超过 24 小时的中断目录；必须保留审计输出。

## 5. 隔离恢复

```powershell
pnpm build:packages
pnpm backup:restore -- --backup D:\backups\novelbrain\<backup-id> --key-file C:\secure\novelbrain-backup.key
```

恢复脚本会创建随机命名的独立 Compose project，使用随机宿主机端口和全新 volume。它会拒绝覆盖非空 project，恢复后比较：

- manifest 中每张表的精确行数；
- 所有 FK 的 orphan 行数必须为 0；
- 数据库对象引用与对象清单一致；
- MinIO 回读 objects 的 SHA-256 和 size；
- 完成后删除隔离 project 和临时明文。

迁移不兼容时，先从迁移前备份完成上述验证，再启动上一版本镜像；不要只回滚容器并保留新 schema。

## 6. 故障与 orphan 清理

恢复流程覆盖 corruption、missing object、interrupted backup 和 interrupted restore。`interrupted_restore_cleanup` 必须确认隔离 project 已删除。

orphan 清理默认 dry-run：

```powershell
pnpm backup:orphans -- --backup D:\backups\novelbrain\<backup-id> --project novel-brain-m0 --minimum-age-days 30
pnpm backup:orphans -- --backup D:\backups\novelbrain\<backup-id> --project novel-brain-m0 --minimum-age-days 30 --apply --confirm-bucket novelbrain
```

只有同时满足“未被数据库引用”和“超过最小年龄”的对象才进入候选。apply 必须显式确认 bucket，输出包含 audit ID、候选、大小和删除结果。

## 7. Drill 与证据

```powershell
pnpm build:packages
pnpm backup:drill -- --output artifacts/backups/drill --evidence docs/implementation/evidence/m3-04b-backup-restore-2026-11-16.json
```

drill 自建隔离源库、迁移、写入引用对象和 aged orphan，完成加密备份、离线验证、隔离恢复和故障注入。实际 RPO 是最近源写入到恢复点的时间，RTO 是恢复开始到完整性验证完成的时间；每次记录 dataset size 和目标是否满足。重复 drill 必须按真实日期新增 evidence 文件。

## 8. 发布门禁

发布前检查以下项全部通过：

1. `backup:verify` 成功。
2. 隔离恢复的 row count、FK 和 object checksum 一致。
3. 当前发布备份在 30 days retention 内且未被 prune。
4. orphan dry-run 已审查，apply 有审计记录。
5. 最近一次 drill 记录实际 RPO/RTO 和 dataset size；未重复测量前不宣称 SLA 已通过。
