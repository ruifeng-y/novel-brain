# M3 Postgres 与对象存储恢复演练记录

## 2026-11-03 V1 最终复验（`8f376a5`）

命令：

```powershell
$env:COMPOSE_PROJECT_NAME = 'novel-brain-v1-acceptance-8f376a5'
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill `
  --backup backups/postgres/20261102T195908Z `
  --verify-key <first-object-key-from-objects-manifest>
```

结果：通过。

- 备份时间：2026-11-02T19:59:08.512Z（Asia/Shanghai 2026-11-03 03:59）。
- 数据库备份 SHA-256：`d9536beb6a59f8030b95b28dce30a4009856af135a17645d2479ae5f1892f838`。
- 备份年龄：2 秒，低于 24 小时 RPO。
- 恢复耗时：3 秒，低于 4 小时 RTO。
- 数据库恢复目标：`novel_restore_drill_20261102195910`，演练后自动删除。
- 行数核对：源快照与恢复库均为 39 个账号、34 部作品、1,173 章、1,186 个章节版本、27 个任务。
- 对象存储源桶：`novel-brain`，全桶前缀，共 13 个对象、57,724 字节。
- 对象集合校验和：`3048e9ea4f6d7ced906c3fb5934166cf78a2f2cb519fd30bfa10bfceea3ddde8`。
- 对象恢复目标：`novel-brain-restore-drill-20261102195910`，演练后自动删除。
- 对象校验：13/13 个对象逐个读取并比对 SHA-256，全部一致。
- 原始证据：`docs/acceptance/m3/restore-drill/20261102T195913Z.json`。

## 2026-11-03 V1 复验（`808a16b`）

命令：

```powershell
$env:COMPOSE_PROJECT_NAME = 'novel-brain-v1-acceptance-808a16b'
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill `
  --backup backups/postgres/20261102T183426Z `
  --verify-key <first-object-key-from-objects-manifest>
```

结果：通过。

- 备份时间：2026-11-02T18:34:26.889Z（Asia/Shanghai 2026-11-03 02:34）。
- 数据库备份 SHA-256：`ac8bd3d16db3f9a11d5d335a3fa66535814f564f740cc2bab6b406c1e95ab1b4`。
- 备份年龄：2 秒，低于 24 小时 RPO。
- 恢复耗时：3 秒，低于 4 小时 RTO。
- 数据库恢复目标：`novel_restore_drill_20261102183428`，演练后自动删除。
- 行数核对：源快照与恢复库均为 38 个账号、33 部作品、1,173 章、1,186 个章节版本、27 个任务。
- 对象存储源桶：`novel-brain`，全桶前缀，共 10 个对象、44,961 字节。
- 对象集合校验和：`e50b8e52d48d6abbe4f66cd2c7ee1b29c81cde5c954b8859d008a0d4ecd072b9`。
- 对象恢复目标：`novel-brain-restore-drill-20261102183428`，演练后自动删除。
- 对象校验：10/10 个对象逐个读取并比对 SHA-256，全部一致。
- 原始证据：`docs/acceptance/m3/restore-drill/20261102T183431Z.json`。

## 2026-11-02

命令：

```bash
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill \
  --backup backups/postgres/20261102T120621Z \
  --verify-key 54db4354-3802-4a90-8998-242d6ce08572/drill/object-backup-20261102T120615Z.txt
```

结果：通过。

- 备份时间：2026-11-02T12:06:21.400Z。
- 数据库备份 SHA-256：`168890ac7327be0aa5a4e010287bb92ebc7f19ab634828c4ce223f4414eabf85`。
- 备份年龄：52 秒，低于 24 小时 RPO。
- 恢复耗时：3 秒，低于 4 小时 RTO。
- 数据库恢复目标：`novel_restore_drill_20261102120713`，演练后自动删除。
- 行数核对：源快照与恢复库均为 2162 个账号、1894 部作品、1182 章、966 个章节版本、758 个任务。
- 对象存储源桶：`novel-brain`，全桶前缀，共 28 个对象、1235 字节。
- 对象集合校验和：`dd1917d96630beec31fba075a662e03ed0f7d9133fd166d3b773346c933c53e9`。
- 对象恢复目标：`novel-brain-restore-drill-20261102120713`，演练后自动删除。
- 对象校验：28/28 个对象逐个读取并比对 SHA-256，全部一致。
- 指定上传对象校验：对象键哈希 `2d60e16dee03f39bcba1e81f30d59a30baa5d2c9b6a97d101af9488b1148f036`，恢复后 SHA-256 为 `602dfc840941398124cc66c826a51e3a47574391d1fa14228449dbc83815ece4`，与上传前一致。
- 原始证据：`docs/acceptance/m3/restore-drill/20261102T120716Z.json`。

证据文件不包含作者正文、邮箱、模型 Key、密文或对象内容。
