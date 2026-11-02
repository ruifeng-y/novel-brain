# M2 端到端验收记录

> 结论：M2 扩大 beta 的多题材、批量生产、审核队列、修改影响分析、平行版本和
> 回滚集成闭环通过。验收中发现并修复 1 个 M2 P1 缺陷；修复后没有未解决的 P0 或
> P1 产品缺陷。M2 是扩大内部测试，不是 V1 公开发布版本。

## 范围

本记录覆盖 GitHub issue #27「M2-07 多题材与修改版本验收」，并复验：

- #21 历史题材包。
- #22 都市题材包。
- #23 批量生产与任务中心。
- #24 修改请求与影响分析。
- #25 平行版本与选择性摘取。
- #26 版本图与回滚。

验收旅程：

1. 创建仙侠、历史、都市三类作品。
2. 用历史与都市题材包分别生成章节，并确认题材上下文进入生成请求。
3. 在仙侠作品中创建两章批量任务。
4. 在审核队列批准第一章，把第二章送到写作台。
5. 创建地点设定修改，检查安全分类和六项一致性检查，应用后撤销。
6. 从已保存正文版本创建平行版本并并排比较。
7. 回滚到较早正文版本，确认正文恢复且历史保留。
8. 搜索和导出审计记录。

## 环境

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-11-02 |
| 时区 | China Standard Time（Asia/Shanghai） |
| 操作系统 | Windows 11 专业版 10.0.26200，64 位 |
| Node.js | v24.22.1 |
| pnpm | 10.20.0 |
| Docker Engine | 29.7.2 |
| Docker Compose | 5.5.0 |
| Playwright | 1.64.1，Chromium |
| 模型路径 | `AI_PROVIDER=fake`，无真实 DeepSeek 调用 |
| Compose 项目 | `novel-brain-m2-acceptance` |
| 数据库迁移 | 35 条 |

Compose 的 API 与 Worker 容器均确认 `AI_PROVIDER=fake`。验收模型使用不可达的
`http://127.0.0.1:9/openai-compatible` 和占位 Key `sk-m2-local-only`。

## 命令与结果

以下命令均在仓库根目录执行。

```powershell
pnpm install --frozen-lockfile
```

结果：通过，8 个 workspace 项目。

```powershell
pnpm lint
```

结果：通过，无 lint 错误或警告。

```powershell
pnpm typecheck --force
```

结果：通过，11/11 个任务成功，0 个缓存命中。

```powershell
pnpm test
```

结果：通过，33 个测试文件，162/162 个 Vitest 测试。

```powershell
pnpm build --force
```

结果：通过，7/7 个包构建成功，0 个缓存命中。

```powershell
$env:AI_PROVIDER = 'fake'
docker compose -p novel-brain-m2-acceptance up -d --build --wait
```

结果：通过。三个应用镜像从当前源码构建成功，8 个服务全部 healthy；全新 Compose
项目、网络和 Postgres/MinIO/Caddy 数据卷创建成功。API 启动时执行 35 条迁移和 seed。

HTTP 冒烟：

- Web HTTP 200。
- API 存活检查 `status=ok`。
- API 就绪检查 `database=up`、`redis=up`、`objectStorage=up`。

```powershell
$env:CI = '1'
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test --workers=4
```

结果：通过，32/32 个 Playwright 测试，35.2 秒。

```powershell
pnpm demo:m2 -- -SkipBuild
```

结果：通过，M2 验收 Playwright 1/1；截图和 metrics 已归档到本目录。

## 性能 smoke 样本

| 指标 | 结果 |
| --- | --- |
| 历史章节生成 | 742 ms |
| 都市章节生成 | 690 ms |
| 批量任务创建到两章待审核 | 3,038 ms |
| 修改影响分析 | 38 ms |
| 核心读取 p95 | 19 ms，40 个样本 |
| 完整浏览器旅程 | 10,669 ms |

这些数字是单机 Docker Compose、单作者、确定性 fake provider 的 smoke 样本，不是
真实模型延迟、并发压测或超长作品规模测试。原始样本见 `metrics.json`。

## 验收标准映射

| Issue #27 标准 | 证据 |
| --- | --- |
| 仙侠、历史、都市都能创建作品并生成章节 | `e2e/m2-acceptance.spec.ts` 创建三题材并生成章节；历史上下文包含 `historyPack`，都市上下文包含 `urban` 主模板；`e2e/history-pack.spec.ts`、`apps/api/test/history-pack.e2e-spec.ts`、`apps/api/test/urban-pack.e2e-spec.ts` 回归通过 |
| 批量任务和审核队列可用 | M2 验收用真实 UI 创建两章区间任务，批准一章并送另一章到写作台；`apps/api/test/batch-jobs.e2e-spec.ts` 覆盖四种范围、暂停、恢复、取消、失败重试、四种审核动作和任务报告 |
| 修改请求、影响分析、平行版本和回滚可用 | M2 验收完成差异、六项检查、安全应用、撤销、平行比较、正文回滚和审计导出；`changes`、`parallel-versions`、`version-graph` API 套件及对应 Playwright 用例回归通过 |
| 所有 M2 验收标准通过，没有 P0 或 P1 缺陷 | 33 个 Vitest 文件 162/162；完整 Playwright 32/32；M2 门禁 1/1；修复 1 个 P1 后无未解决 P0/P1 |
| 明确 M2 为扩大 beta | 根 README、工作台可见标识、本目录 README、演示脚本和本记录均明确扩大内部 beta |

## #21-#26 回归覆盖

| Ticket | 集成验收证据 |
| --- | --- |
| #21 历史题材包 | 历史作品创建、架空主模板、历史规则面板、`historyPack` 生成上下文 |
| #22 都市题材包 | 都市作品创建、城市/公司/家族/阶层/法律/金钱/人脉子类型、普通都市章节事实抽取 |
| #23 批量与任务中心 | 按章/卷/区间/全本、任务状态机、审核队列四种动作、任务报告和隔离 |
| #24 修改请求 | 差异、原因、来源、风险、安全/可修复/结构性分类、六步检查、误报和取消 |
| #25 平行版本 | 历史版本分叉、并排比较、选择性摘取、copy-on-write 和作品隔离 |
| #26 版本图 | 不可删除历史、图结构、撤销、完整回滚、审计搜索与 CSV 导出 |

## 验收中修复的缺陷

- **P1：普通都市章节在事实抽取阶段失败。** 都市正文可以完成起草，但确定性 fake
  provider 只识别特殊 `[[URBAN_CONFLICTS]]` 测试片段，普通都市章节返回不足三种
  事实类型，导致 `FACT_EXTRACTION_INVALID`，整章生成失败。修复后 fake provider
  能从普通都市正文抽取事件、身体状态和角色认知，并保证来源原句逐字存在。新增
  `packages/ai/src/fact-extraction.test.ts` 回归测试，M2 验收旅程通过。

P0/P1 定义：P0 为数据丢失、安全破坏、无法启动或全站不可用；P1 为阻断 M2 核心
验收路径、导致用户无法完成作品创建、生成、审核、修改、版本或回滚的缺陷。

## 已知限制与未验证项

- 只验证确定性 fake provider，没有调用真实 DeepSeek；真实模型的文本质量、延迟、
  限流、费用和结构化输出稳定性不在本次验收范围。
- 性能样本只覆盖单作者、小样本、本机 Docker Compose；没有验证并发、300 万字、
  1000 章、云部署或跨区域网络。
- 没有进行人工盲评、真实读者反馈、公开平台发布规则或 M3 合规验收。
- 没有重新验证 M3 的导出发布、备份恢复、TLS、生产 SMTP、云安全和总验收。
- 验收截图由 Playwright 自动生成；本次执行环境的模型无法对 PNG 做视觉语义复核，
  但截图对应页面断言、元素截图和完整页面流程均已通过。

## 残余风险

- 真实模型可能返回不符合事实抽取 schema 的内容，仍需在扩大 beta 中持续采样。
- 批量任务使用顺序生成和人工审核；高并发、多分支同时写入和超大卷级任务仍需压测。
- 修改影响分析是规则加启发式判断，复杂下游影响仍可能漏报或需要作者人工判断。
- 平行版本选择性摘取不做自动语义合并，冲突内容仍依赖作者逐项确认。

## 发布边界

M2 完成只表示三题材、批量生产、修改版本可以作为内部扩大 beta 使用。它不是 V1
公开发布，不具备公开服务所需的安全、合规、灾备、性能或质量承诺。
