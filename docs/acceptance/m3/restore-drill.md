# M3 恢复演练记录

## 2026-11-02

命令：

```bash
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill \
  --backup backups/postgres/20261102T114918Z
```

结果：通过。

- 备份时间：2026-11-02T11:49:18.426Z。
- 备份 SHA-256：`0f320a67c9b9d16452d3fbd3c174dcd07ec0bcd956a1e83434d5ce4a05a9bbfd`。
- 备份年龄：6 秒，低于 24 小时 RPO。
- 恢复耗时：3 秒，低于 4 小时 RTO。
- 恢复目标：`novel_restore_drill_20261102114924`，演练后自动删除。
- 行数核对：源快照与恢复库均为 1657 个账号、1455 部作品、930 章、756 个章节版本、620 个任务。
- 原始证据：`docs/acceptance/m3/restore-drill/20261102T114927Z.json`。

证据文件不包含作者正文、邮箱、模型 Key、密文或数据库内容。
