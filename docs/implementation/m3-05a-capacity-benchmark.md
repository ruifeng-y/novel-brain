# M3-05a 1000 万字容量基准、数据生成器与负载模型

> Issue: #137
> Capability: PERF-001
> Status: benchmark harness implemented; 10M certification is not complete

## 1. 实现范围

- 新增 `@novel-brain/capacity-benchmark` workspace 包，提供确定性夹具计划、校验、数据库装载、真实 HTTP 负载、指标汇总与发布门禁报告。
- 夹具按 seed 生成精确 `10,000,000` Unicode code point 的主线文本，并单独记录 UTF-8 bytes 与 SHA-256。
- 支持 `smoke`、`growth`、`full`、`boundary`、`recovery` 层级；`growth` 支持 10%、25%、50%、75% 进度，不作为容量声明。
- 默认 full topology 为 3,500 章 / 35 卷；boundary 支持 4,000 章 / 40 卷。不可行的目标字数与章节范围会直接失败，不会静默改值。
- 装载写入集成生产 schema，包括 branch/version graph、章节与版本、故事圣经、设置实体、正史事实、摘要、搜索文档、导入、导出、任务/步骤/检查点/事件、成本与模型调用记录。
- 平行版本数量由运行参数显式提供；它不是已批准的产品分支上限。
- 负载模型覆盖 overview/chapter/history/bible/entity/timeline/branch 读、章节写入、设置更新、正史提交、标题/正文/别名搜索、ContextPack、索引重建、SSE、导出和并发批量任务。
- 原始请求样本写为 NDJSON；summary 记录吞吐、p50/p95/p99、错误率、队列等待、数据库/索引/对象存储大小、CPU/RAM/IO 与模型成本。
- 报告只有在 approved targets 全部通过、恢复证据通过、环境匹配批准的 8 vCPU / 16 GB / 100 GB 基线且所有 decision-required 项已签收时才允许 `tenMReady=true`。

## 2. Decision-required

以下项目没有在实现中填入通过阈值：

- 数值 p99 上限。
- API 并发与会话目标。
- 可接受错误率与饱和率。
- 100 GB 主机内要求的存储余量。
- 备份容量是否包含在 100 GB 磁盘 envelope 内。
- 恢复数据集层级。
- 大版本/分支比较延迟 allowance。
- 已批准的产品 branch 数量。
- 主机/基础设施成本费率。
- 真实 Provider 首 token 与吞吐样本；fake provider 不能替代该证据。

## 3. 本地运行

以下命令必须通过原生 PowerShell 执行。

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm --filter @novel-brain/worker build
docker exec novel-brain-m0-postgres-1 createdb -U novelbrain novelbrain_benchmark
```

生成并装载 full fixture：

```powershell
node packages/capacity-benchmark/dist/cli.js seed `
  --database-url "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_benchmark" `
  --confirm-database novelbrain_benchmark `
  --seed 20261117 `
  --tier full `
  --topology mid `
  --branches 3 `
  --output artifacts/capacity/full/fixture-manifest.json
```

启动隔离的本地 API/Worker：

```powershell
.\scripts\capacity\start-local.ps1 `
  -DatabaseUrl "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_benchmark" `
  -RedisUrl "redis://localhost:6379/3" `
  -ApiPort 3101 `
  -OutputDirectory "artifacts/capacity/runtime"
```

记录环境并执行负载：

```powershell
node packages/capacity-benchmark/dist/cli.js environment `
  --api-base-url http://localhost:3101 `
  --output artifacts/capacity/full/environment.json

node packages/capacity-benchmark/dist/cli.js workload `
  --fixture artifacts/capacity/full/fixture-manifest.json `
  --api-base-url http://localhost:3101 `
  --database-url "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_benchmark" `
  --confirm-database novelbrain_benchmark `
  --concurrency 4 `
  --duration-seconds 60 `
  --ramp-seconds 10 `
  --output artifacts/capacity/full
```

停止写入者后执行 full backup/restore：

```powershell
.\scripts\capacity\stop-local.ps1 -RuntimeDirectory "artifacts/capacity/runtime"

[Environment]::SetEnvironmentVariable(
  "BACKUP_ENCRYPTION_KEY_BASE64",
  "<32-byte-base64-key>",
  "Process"
)

node scripts/capacity/recovery.mjs `
  --project novel-brain-m0 `
  --database-name novelbrain_benchmark `
  --database-url "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_benchmark" `
  --output artifacts/capacity/backups `
  --evidence docs/implementation/evidence/m3-137-capacity-recovery-2026-11-17.json
```

生成受门禁报告：

```powershell
node packages/capacity-benchmark/dist/cli.js report `
  --fixture artifacts/capacity/full/fixture-manifest.json `
  --workload artifacts/capacity/full/workload-summary.json `
  --environment artifacts/capacity/full/environment.json `
  --recovery docs/implementation/evidence/m3-137-capacity-recovery-2026-11-17.json `
  --output artifacts/capacity/full/capacity-report.json
```

备份 payload、运行日志和临时 artifacts 不进入 Git。提交的 evidence 只包含 manifest、summary、raw request samples 和恢复校验摘要。

## 4. 搜索路径修正

首轮 full 负载暴露搜索 p95 超过 1 秒。原查询对完整正文执行 `similarity(content, q)`，导致 3,500 个搜索文档顺序扫描并计算 trigram 相似度。

实现改为：

- 正文候选由生产 `tsv` 的 simple prefix tsquery 过滤。
- 标题和别名使用 `pg_trgm` similarity 排序。
- 查询输入在应用层规范化为安全 token，再构造 prefix tsquery。

该改动仍属于 #137 的性能修正，因为它在真实 10M 负载下直接阻塞已批准的 search p95 目标。

## 5. 认证边界

初步 full 运行只用于验证生成器、负载模型、指标采集和恢复链路，不构成 10M-ready 结论。认证必须使用批准主机、已签收 decision-required 阈值、真实 Provider 采样和最终提交 SHA 重新运行。
