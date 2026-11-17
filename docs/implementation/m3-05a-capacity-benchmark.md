# M3-05a 1000 万字容量基准、数据生成器与负载模型

> Issue: #137
> Capability: PERF-001
> Status: benchmark harness implemented; preliminary full-run evidence recorded; 10M certification is not complete

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
```

推荐使用隔离的 Docker Compose 容量栈。`scripts/capacity/compose.capacity.yml` 将 API、Worker、Postgres、Redis 和 MinIO 的稳态资源上限合计固定为 8 vCPU / 16 GB，并使用独立的 Compose project、数据库和对象桶：

```powershell
.\scripts\capacity\start-compose.ps1 -Build
```

该脚本输出：

- API：`http://localhost:3101`
- Postgres：`localhost:35432`
- Redis：`localhost:36379`
- MinIO metrics：`http://127.0.0.1:39000/minio/v2/metrics/cluster`

生成并装载 full fixture：

```powershell
.\scripts\capacity\seed-compose.ps1
```

该脚本向 seed 进程显式注入隔离 MinIO 配置，缺少对象存储时会直接失败，不再静默生成 0 个对象。输出固定为 `artifacts/capacity/full-compose/fixture-manifest.json`。

记录环境并执行负载。`--compose-project` 会把运行中容器的实际 CPU/内存限额写入 manifest，并把资源采样限制在同名 Compose project：

```powershell
node packages/capacity-benchmark/dist/cli.js environment `
  --api-base-url http://localhost:3101 `
  --compose-project novel-brain-capacity `
  --output artifacts/capacity/full-compose/environment.json

node packages/capacity-benchmark/dist/cli.js workload `
  --fixture artifacts/capacity/full-compose/fixture-manifest.json `
  --environment artifacts/capacity/full-compose/environment.json `
  --api-base-url http://localhost:3101 `
  --database-url "postgresql://novelbrain:novelbrain@localhost:35432/novelbrain_benchmark" `
  --confirm-database novelbrain_benchmark `
  --concurrency 4 `
  --duration-seconds 60 `
  --ramp-seconds 10 `
  --storage-metrics-url http://127.0.0.1:39000/minio/v2/metrics/cluster `
  --compose-project novel-brain-capacity `
  --output artifacts/capacity/full-compose
```

停止写入者后执行 full backup/restore：

```powershell
.\scripts\capacity\stop-compose.ps1

[Environment]::SetEnvironmentVariable(
  "BACKUP_ENCRYPTION_KEY_BASE64",
  "<32-byte-base64-key>",
  "Process"
)

node scripts/capacity/recovery.mjs `
  --project novel-brain-capacity `
  --bucket novelbrain-capacity `
  --database-name novelbrain_benchmark `
  --database-url "postgresql://novelbrain:novelbrain@localhost:35432/novelbrain_benchmark" `
  --workload-summary artifacts/capacity/full-compose/workload-summary.json `
  --output artifacts/capacity/backups `
  --evidence docs/implementation/evidence/m3-137-capacity-recovery-compose-2026-11-17.json
```

生成受门禁报告：

```powershell
node packages/capacity-benchmark/dist/cli.js report `
  --fixture artifacts/capacity/full-compose/fixture-manifest.json `
  --workload artifacts/capacity/full-compose/workload-summary.json `
  --environment artifacts/capacity/full-compose/environment.json `
  --recovery docs/implementation/evidence/m3-137-capacity-recovery-compose-2026-11-17.json `
  --query-plans docs/implementation/evidence/m3-137-query-plans-compose-2026-11-17.txt `
  --output artifacts/capacity/full-compose/capacity-report.json
```

若已有绑定同一 `runId` 和 source commit 的故障注入结果，再追加：

```powershell
  --failure-injection artifacts/capacity/full-compose/failure-injection.json
```

备份 payload、运行日志和临时 artifacts 不进入 Git。提交的 evidence 只包含 manifest、summary、raw request samples 和恢复校验摘要。

容器资源预算与批准主机不是同一认证条件：`containerBudgetMatches=true` 只证明该次运行的服务资源上限为 8 vCPU / 16 GB。是否允许用资源受限的大主机替代精确的 8 vCPU / 16 GB 主机，仍需发布负责人明确签收；在此之前 `certificationEligible` 仍保持 `false`。

## 4. 搜索路径修正

首轮 full 负载暴露搜索 p95 超过 1 秒。原查询对完整正文执行 `similarity(content, q)`，导致 3,500 个搜索文档顺序扫描并计算 trigram 相似度。

实现改为：

- 正文候选由生产 `tsv` 的 simple prefix tsquery 过滤。
- 标题和别名使用 `pg_trgm` similarity 排序。
- 查询输入在应用层规范化为安全 token，再构造 prefix tsquery。

该改动仍属于 #137 的性能修正，因为它在真实 10M 负载下直接阻塞已批准的 search p95 目标。

## 5. 受控 Compose full-run 证据

本轮证据绑定 source commit `c059fd50c783c727f034542f9ee34dd178688024` 与 workload runId `capacity-2026-11-17T12-45-37-300Z-72acf7d2`。运行中五个容量服务均为受限容器，CPU 合计 `8` cores、内存合计 `17,179,869,184` bytes，`containerBudgetMatches=true`。

Fixture：

- 主线逻辑文本：`10,000,000` Unicode code points。
- UTF-8 manuscript bytes：`30,000,000`。
- manuscript SHA-256：`4526d09e8bee2690905a1f74e8d1d6d54190e80559727fa15b2bc5b5c8a13365`。
- 3,500 章 / 35 卷；3 个平行分支，分叉章分别为 875、1,750、2,625。
- 3,643 个 chapter versions、100 个 entity versions、35 个 outline versions、70 个 canon commits、6 个 change apply、3 个 branch merge 和 1 个 rollback node。
- 生成 6 个对象，共 `196,608` bytes，并记录 SHA-256。

60 秒混合负载（4 API clients，10 秒 ramp；并发不是已批准目标）：

- 2,500 / 2,502 请求成功，2 次 `409 VERSION_CONFLICT`，错误率 `0.00079936`。
- throughput `40.11 req/s`，p50 `31ms`，p95 `226ms`，p99 `1,042ms`。
- interactive read p95 `168ms`，p99 `310ms`。
- search p95 `344ms`。
- SSE 事件投递 p95 `126.61ms`。
- index rebuild `4,304ms`，export `1,042ms`，批量计划观测 `7,723ms`；结束时任务状态包含 `completed: 1`、`queued: 2`、`running: 2`，queue wait p95/max 为 `248ms`。
- 数据库 `88,366,103` bytes；表 `45,498,368` bytes；索引 `29,941,760` bytes；temp `43,155,456` bytes；deadlock `0`。
- 负载窗口对象存储观测为 7 objects / `31,820,017` bytes，其中 6 个为 fixture 对象。
- fake provider 模式 model cost 为 `0 CNY`；基础设施成本仍为 `decision-required`。

恢复：

- 备份/隔离恢复 `status=passed`，24,332 rows、10 objects、`126,690,244` object bytes。
- 恢复耗时 `19.545s`，实测 RTO `0.00542917h`；实测 RPO `0.01324583h`。
- FK violations `0`，数据库行数与对象 checksum 全部一致。
- 恢复 evidence 绑定同一 workload runId 和 source commit。

Query plans 位于 `docs/implementation/evidence/m3-137-query-plans-compose-2026-11-17.txt`，并绑定同一 workload runId。

## 6. 认证边界

受控 Compose 运行仍不构成 10M-ready 结论。认证必须使用批准主机、已签收 decision-required 阈值、真实 Provider 采样和最终提交 SHA 重新运行。

当前 release report 仍为 `blocked`：

- 物理主机为 16 vCPU / Docker 32 GB；容器预算精确限制为 8 vCPU / 16 GB，但“资源受限大主机”能否替代批准主机仍需正式签收。
- 真实 Provider first-token 尚未采样。
- 数值 p99、API concurrency、错误率、存储余量、备份磁盘边界、恢复层级、大版本比较和产品 branch 数量仍未签收。
- 故障注入 evidence 尚未覆盖 worker/API/Redis/Postgres/provider/disk/import/index/restore 全场景。

因此报告保持 `tenMReady=false`。
