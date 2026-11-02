# M3 恢复演练记录

## 2026-11-02

命令：

```bash
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill \
  --backup backups/postgres/20261102T110239Z
```

结果：通过。

- 备份时间：2026-11-02T11:02:39.385Z。
- 备份 SHA-256：`46b480ca35bf6ca6b14599f4e60d8f5b742fd19d1dc8bff2d72a958c209c9986`。
- 备份年龄：5 秒，低于 24 小时 RPO。
- 恢复耗时：3 秒，低于 4 小时 RTO。
- 恢复目标：`novel_restore_drill_20261102110244`，演练后自动删除。
- 行数核对：源快照与恢复库均为 289 个账号、256 部作品、158 章、149 个章节版本、97 个任务。
- 原始证据：`docs/acceptance/m3/restore-drill/20261102T110247Z.json`。

证据文件不包含作者正文、邮箱、模型 Key、密文或数据库内容。
