# M3 Postgres 与对象存储恢复演练记录

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
