# NovelBrain V1 迁移、备份与回滚 Runbook

> 适用版本：V1.0.0-rc.1 / 代码基线 `c424aed`  
> 当前迁移：`0000` 到 `0036`，共 37 条  
> 目标：RPO 24 小时，RTO 4 小时  
> 注意：本 runbook 不替代生产变更审批；公网发布前还必须完成 TLS、静态加密、
> 日志保留和法务确认。

## 1. 角色与变更窗口

| 角色 | 责任 |
| --- | --- |
| 发布负责人 | 批准变更窗口、确认门禁和回滚决定 |
| 运维负责人 | 备份、迁移、切换、健康检查和恢复 |
| 工程负责人 | 应用版本、迁移兼容性、故障定位和回滚执行 |
| 产品负责人 | 发布说明、已知限制和对外沟通 |

默认变更窗口：

1. 先完成备份和恢复演练。
2. 再执行迁移和应用切换。
3. 最后做冒烟测试和观察。

超过 RTO 4 小时仍未恢复，按事故升级；不得在未备份的情况下继续迁移。

## 2. 发布前检查

在干净 CI 或等价环境执行：

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck --force
pnpm test
pnpm build --force
$env:AI_PROVIDER = 'fake'
docker compose -p novel-brain-v1-acceptance up -d --build --wait
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test --workers=4
```

确认：

- Compose 全部服务 healthy。
- `/api/v1/health` 返回 `status=ok`。
- `/api/v1/health/ready` 的 database、redis、objectStorage 均为 `up`。
- `drizzle.__drizzle_migrations` 计数与发布版本一致。
- 生产环境已设置强 `SESSION_SECRET`、`MODEL_KEY_ENCRYPTION_KEY` 和非默认
  `novel_app` 密码；不要设置 `ALLOW_DEFAULT_DB_PASSWORD`。
- 外部监控、TLS、日志保留和告警已由部署负责人确认。当前仓库没有内置
  Prometheus/Grafana/OTel/Sentry/Langfuse 部署证据，不能假定已启用。

检查迁移数：

```powershell
docker compose -p <project> exec -T postgres `
  psql -U novel -d novel -tAc "select count(*) from drizzle.__drizzle_migrations;"
```

本版本期望 `37`。

## 3. 备份

### 3.1 数据库和对象存储

```powershell
$env:COMPOSE_PROJECT_NAME = '<project>'
node scripts/ops.mjs backup
```

产物在 `backups/postgres/<UTC 时间>/`：

- `database.pgcustom`：Postgres custom dump。
- `manifest.json`：数据库 SHA-256、行数、对象数量/字节/校验和、RPO/RTO。
- `objects-manifest.json`：对象键、内容类型、大小、ETag、SHA-256。
- `objects/`：内容寻址对象副本。

必须把 `backups/` 同步到独立磁盘、NAS 或启用版本控制的对象存储。只留在应用主机
不满足容灾要求。备份目录已被 `.gitignore` 忽略，不得提交。

### 3.2 备份后核对

```powershell
Get-Content -Raw backups/postgres/<timestamp>/manifest.json
```

确认：

- `createdAt` 在当前时区换算后不超过 24 小时。
- `sha256` 存在。
- `rowCounts` 包含账号、作品、章节、章节版本和任务。
- `objectStore.objectCount` 与 `objects-manifest.json` 一致。

如果备份失败或对象数为 0，停止发布。

## 4. 迁移

### 4.1 应用迁移

生产迁移只使用管理员连接：

```powershell
$env:DATABASE_ADMIN_URL = 'postgres://<admin>:<password>@<host>:5432/novel'
pnpm --filter @novel/db db:migrate
```

或让 API 容器启动命令先执行迁移。迁移完成后：

1. 核对迁移计数。
2. 检查数据库日志没有错误。
3. 运行 health/ready。
4. 做登录、作品读取、单章读取和导出冒烟。

### 4.2 迁移兼容性

- 当前项目没有 down migration。
- 迁移是前向追加；不要把迁移文件改写成不同语义。
- 如果后续 ticket 引入新迁移，合并前按集成顺序重新编号并更新 snapshot。
- 迁移失败时保留现场，不重复执行破坏性 SQL；按第 6 节回滚。

## 5. 部署与冒烟

启动应用版本：

```powershell
docker compose -p <project> up -d --wait api worker web caddy
```

冒烟：

```powershell
Invoke-RestMethod http://<host>/api/v1/health
Invoke-RestMethod http://<host>/api/v1/health/ready
```

至少验证：

- 登录和退出。
- 打开作品列表和工作台。
- 打开一章正文和版本历史。
- 读取地图图片。
- 导出一个小范围文件并下载。
- 单章生成（若使用真实 Key，确认供应商可用；若使用 fake，仅验证链路）。

记录结果、时间、版本、迁移数和操作人。

## 6. 回滚

### 6.1 决策

出现以下任一情况立即停止继续迁移或切换：

- 迁移失败或 schema 与代码不兼容。
- 登录、作品读取、正史读取或导出连续失败。
- 数据隔离、Key 泄露或 RLS 失效。
- 健康检查持续失败。
- 恢复后行数或对象校验不一致。

### 6.2 应用回滚（数据库兼容时）

如果数据库 schema 仍兼容上一版本：

1. 停止 API 和 Worker，避免继续写入。
2. 切回上一发布镜像或上一 Git revision 重新构建。
3. 保持同一数据库和对象桶。
4. 启动并执行冒烟。

不要用 `git reset --hard` 清理工作区；使用已构建镜像或独立 checkout。

### 6.3 完整回滚（数据库不兼容时）

1. 停止 API 和 Worker。
2. 保留失败数据库，不删除现场；拍快照或改名隔离。
3. 从最近备份恢复到新的临时数据库。CLI 要求目标名以
   `novel_restore_drill_` 开头：

```powershell
$env:COMPOSE_PROJECT_NAME = '<project>'
node scripts/ops.mjs restore `
  --backup backups/postgres/<timestamp> `
  --target-db novel_restore_drill_<timestamp> `
  --drop-existing
```

4. 把对象存储恢复到隔离桶：

```powershell
node scripts/ops.mjs restore `
  --backup backups/postgres/<timestamp> `
  --target-db novel_restore_drill_<timestamp> `
  --object-bucket novel-brain-restore-drill-<timestamp> `
  --drop-existing
```

5. 对比 `manifest.json` 的行数和对象校验和。
6. 停止旧应用，把 `DATABASE_URL`、`DATABASE_ADMIN_URL` 和 `MINIO_BUCKET` 指向恢复
   目标；保留原库和原桶，不删除。
7. 启动上一兼容应用版本，做登录、作品、章节、地图图片、导出和生成冒烟。
8. 如果恢复失败，切回原库和原桶；不要删除任何数据。

### 6.4 仅对象存储回滚

如果数据库正常但对象损坏：

1. 停止 API 和 Worker 的对象写入路径。
2. 把备份对象恢复到隔离桶。
3. 逐个校验 `manifest.json` 中的对象数量和集合校验和。
4. 切换 `MINIO_BUCKET`。
5. 验证地图图片和导出下载。

## 7. 恢复演练

发布候选至少执行一次：

```powershell
$env:COMPOSE_PROJECT_NAME = '<project>'
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill `
  --backup backups/postgres/<timestamp> `
  --verify-key <uploaded-object-key>
```

通过条件：

- 备份年龄不超过 24 小时。
- 恢复耗时不超过 4 小时。
- 数据库行数一致。
- 对象数量、集合校验和和逐对象 SHA-256 一致。
- 证据写入 `docs/acceptance/m3/restore-drill/<timestamp>.json`。

2026-11-02 V1 验收证据：

- `docs/acceptance/m3/restore-drill/20261102T154620Z.json`
- 数据库恢复 3 秒，备份年龄 12 秒。
- 28 个账号、28 部作品、1,169 章、1,182 个章节版本、27 个任务行数一致。
- 3/3 对象逐字节校验。

演练失败时不要删除旧备份，也不要执行正式切换。

## 8. 发布后观察

- 观察 API 5xx、健康检查、生成失败率、SSE 延迟、导出失败和恢复任务。
- 确认日志不包含正文、密码、模型 Key 或密文。
- 确认审计记录覆盖登录、Key 变更、导出和删除。**当前版本尚未实现账号级审计，
  因此该项在公开发布前必须关闭。**
- 确认备份任务按时完成并复制到异地。

## 9. 当前环境限制

- 本 runbook 已在 Windows Docker Compose + fake provider 环境演练；生产 Linux
  集群、云数据库、生产 SMTP、TLS 和对象存储加密仍需单独验证。
- 当前 Compose 的默认密码和密钥仅用于本地开发；生产必须替换。
- 外部监控链未随仓库交付，发布负责人必须单独确认。
