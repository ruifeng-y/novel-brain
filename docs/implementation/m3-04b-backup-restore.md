# M3-04b 全量备份、恢复演练与 RPO/RTO 证据

> Issue: #136
> Capabilities: OPS-002, IO-007
> Status: implemented; release evidence recorded

## 1. 实现范围

- 增加宿主机运维 CLI：`backup:create`、`backup:verify`、`backup:restore`、`backup:drill`、`backup:orphans`、`backup:prune` 和 `backup:show`。
- Postgres 使用 custom-format dump；MinIO 使用 `mc mirror --preserve`。manifest 记录表级行数、FK 定义与违规数、migration 文件 checksum、对象 key/size/SHA-256 和对象引用。
- `backup:create` 默认在快照前停止运行中的 API/Worker，完成 dump 和对象镜像后恢复服务；外部写入方仍需维护窗口。
- 数据库与对象文件使用 AES-256-GCM；AAD 绑定 backup ID 和相对路径，manifest 只记录 key fingerprint，不记录密钥。
- 明文只存在于操作系统临时 staging，备份输出目录从一开始只接收密文；成功、失败或中断后的正常清理都不会把 `pg_dump`/对象明文留在备份目录。
- 备份目录以 `completion.json` 作为提交标记。manifest hash 不匹配、ciphertext checksum 不匹配或缺少对象时，verify/restore 拒绝继续。
- restore 创建随机隔离 Compose project，使用新 volume 和随机端口；完成后逐表比较行数、检查 FK、回读 MinIO checksum，并清理 project。
- orphan 检测从实时 bucket 清单和当前数据库引用计算，只选择“未被引用且超过最小年龄”的对象；删除前再次读取引用。默认 dry-run，apply 必须确认 bucket，并返回及持久化 audit ID、候选、跳过和删除结果。
- 默认 retention 30 days。prune 同时处理到期备份和超过 24 小时的中断备份目录。
- `infra/backup/object-references.json` 登记对象存储引用列；新增对象列必须同步登记。

## 2. 验收证据

2026-11-16 的 Docker drill 通过，证据位于
`docs/implementation/evidence/m3-04b-backup-restore-2026-11-16.json`。

- Schema baseline：`f1bcee46e504d76d6c8618c3528054af7ba93a93`；drill 时的 backup tool commit：`6a1fa18df95975dfc9e5569f80c4022550cc5b37`。
- 数据：67 行、2 个对象、数据库明文 680,474 bytes；完整 encrypted backup 5 个文件、704,387 bytes。
- 离线验证：数据库和两个对象均成功解密并匹配 SHA-256。
- 隔离恢复：实测 RTO 约 13.461 秒；恢复后 67 行、2 个对象、529 个 FK 约束全部为 0 违规。
- 实测 RPO 约 0.213 秒；目标仍为 RPO 24h / RTO 4h。单次 drill 只作为证据，不宣称生产 SLA。
- `interrupted_backup` 在真实 `backup:create` 中注入失败，确认输出目录无明文；`missing_object`、`corrupt_object`、`interrupted_restore` 和 cleanup 也全部按预期通过。
- orphan dry-run 检出 aged 未引用对象，随后在显式 bucket 确认下删除；dry-run 与 apply 均持久化独立 audit 文件。
- 定向测试覆盖引用解析、路径穿越、加密认证、manifest 完整性、completion marker、恢复 parity、retention/prune 和 orphan 年龄边界。
- `scripts/deployment-guardrails.mjs` 校验 backup runbook、生产密钥占位、保留边界和命令入口。

## 3. 运维边界

- MinIO 没有 database/object 原子快照；生产全量备份必须在停写窗口运行，或在未来增加业务级 advisory lock write gate。
- 真实 10M 数据恢复时间和磁盘占用由 #137 继续测量；本 ticket 不证明容量或 SLA。
- 备份 payload 不进入 git，只提交 manifest/evidence 摘要和 runbook。运行目录由 `.gitignore` 排除。
- 当前未实现托管对象存储版本化；切换 provider 时必须补充等价 snapshot、encryption 和 retention 证据。

## 4. Retro 结论

- 这次真实 drill 暴露了 Windows 单参数 SQL 触发 `ENAMETOOLONG`；实现已改为临时 SQL 文件经 stdin 传给 `psql`。
- 首次 Docker drill 误把镜像构建放进恢复前路径；已改为使用本地已构建 migration runtime，构建时间不再污染 RTO 证据。
- code review 发现生产示例固定密钥、悬空引用假阳性、中断备份明文残留和历史 orphan 状态风险；均已用占位符、对象存在性校验、临时 staging 和当前引用复核修正。
- writer 自动恢复失败现在会向上抛出并写入 `writer-restart-failed.json`，不会出现“备份成功但服务停着”的静默状态。
- WSL 误跑 `pnpm` 的既有 guardrail 再次拦截 `@pnpm/exe` lockfile 污染。后续所有命令继续显式使用原生 PowerShell。
