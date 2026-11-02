# M1 端到端验收记录

> 结论：M1 仙侠内部连载闭环通过。M1 只用于内部 beta，不是公开发布版本。
> 验收中发现并修复 1 个 M1 P1 设定编辑器竞态；修复后未发现未解决的 P0 或 P1
> 产品缺陷。

## 范围

本记录覆盖 GitHub issue #20「M1-10 仙侠可连载验收」，并复验 M1-01 到 M1-09
已关闭的验收行为：

1. 完整故事圣经、锁定与提醒。
2. 设定中心、自定义字段、类型化关系、人物档案与状态。
3. 地图、旅行时间、势力控制与人物行踪。
4. 力量体系、金手指、物品归属和时间线。
5. 五层大纲、准备度和剧情账本。
6. 完整写作台的生成、保存和上下文面板。
7. 三章顺序生成、事实确认和上下文续接。
8. 连续性与六项质量报告。
9. 桌面与移动视口。

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
| 干净 Compose 项目 | `novel-brain-m1-acceptance` |

验收模型使用不可达的 `http://127.0.0.1:9/openai-compatible` 和占位 Key
`sk-m1-local-only`。若 fake provider 未生效，生成会安全失败，不会回退到真实
DeepSeek。

## 命令与结果

以下命令均在仓库根目录执行。

```powershell
pnpm install --frozen-lockfile
```

结果：通过，8 个 workspace 项目。

```powershell
pnpm lint
```

结果：通过，无 lint 错误。

```powershell
pnpm typecheck --force
```

结果：通过，11/11 个任务成功，0 个缓存命中。

```powershell
pnpm test
```

结果：通过，15 个测试文件，91/91 个 Vitest 测试。

```powershell
pnpm build --force
```

结果：通过，7/7 个包构建成功，0 个缓存命中。

```powershell
$env:AI_PROVIDER = 'fake'
docker compose -p novel-brain-m1-acceptance config --format json
docker compose -p novel-brain-m1-acceptance build --no-cache
docker compose -p novel-brain-m1-acceptance up -d --wait
```

最终复验使用全新项目 `novel-brain-m1-gate-clean` 和全新数据卷。Docker Compose
配置解析通过，三个应用镜像以 `--no-cache` 构建成功，8 个服务全部 healthy。
API 启动后执行 27 条迁移和 seed；初始 `works = 0`，`system_jobs = 2`。
API、Worker 容器内均确认 `AI_PROVIDER=fake`。

HTTP 冒烟：

- Web HTTP 200。
- API 存活检查 `status=ok`。
- API 就绪检查 `database=up`、`redis=up`、`objectStorage=up`。
- Mailpit API HTTP 200。
- MinIO live HTTP 200。

```powershell
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test e2e/m1-acceptance.spec.ts
```

结果：通过，1/1 个 M1 验收 Playwright 测试；Playwright 计时 7.7 秒。

```powershell
$env:AI_PROVIDER = 'fake'
$env:CI = '1'
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
pnpm test:e2e
```

最终在干净 Compose 环境执行：

```powershell
$env:CI = '1'
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test --workers=4
```

结果：通过，21/21 个 Playwright 测试，18.3 秒。

```powershell
pnpm demo:m1 -- -SkipBuild
```

结果：通过。脚本确认 8 个服务健康、API 存活与就绪、M1 验收 Playwright 1/1
通过，并复制九张截图和性能样本到文档目录。

## 本次 M1 验收样本

2026-11-02 的隔离 fake-AI 运行生成了以下样本：

| 指标 | 结果 |
| --- | --- |
| 三章顺序生成 | 1,382 ms / 885 ms / 873 ms |
| 完整浏览器旅程 | 9,193 ms |
| 核心读取 p95 | 24 ms，60 个样本 |
| 设定搜索 p95 | 17 ms，20 个样本 |
| 已确认事实 | 9 条，覆盖第 1、2、3 章 |
| 六项质量报告 | 钩子可提升；节奏良好；信息密度可提升；人物声纹可提升；文笔良好；连续性良好 |
| 未处理连续性问题 | 0 |

这些数字是单机 Docker Compose、单作者、确定性 fake provider 的 smoke 样本，
不是真实模型延迟、并发压测或 300 万字规模测试。

原始样本见 `metrics.json`。

## 验收标准映射

| Issue #20 标准 | 证据 |
| --- | --- |
| 仙侠作品能完成故事圣经、设定、大纲、连续生成多章和连续性检查 | `e2e/m1-acceptance.spec.ts` 完成九卡故事圣经、七类自定义字段、七类设定、五层大纲、三章顺序生成、九条事实确认、后章上下文续接和连续性检查 |
| 所有 M1 验收标准通过，没有 P0 或 P1 缺陷 | M1-01 到 M1-09 的现有测试全量通过；新增 M1 门禁和回归测试通过；修复后无未解决 P0/P1 |
| 内部连载演示完成 | `demo.md`、`scripts/m1-demo.ps1`、九张稳定截图 |
| 性能、质量和测试记录归档 | 本文件的性能样本、质量状态、完整命令结果和 `metrics.json` |
| 明确 M1 为内部 beta | 本目录 README、演示脚本、根 README 和本记录均明确内部 beta、不公开发布 |

## 截图

- `screenshots/01-story-bible-locked.png`：完整故事圣经与锁定状态。
- `screenshots/02-five-level-outline.png`：五层大纲。
- `screenshots/03-generation-readiness.png`：生成准备度。
- `screenshots/04-settings-center.png`：设定中心。
- `screenshots/05-map-and-faction.png`：地图与势力。
- `screenshots/06-six-part-quality-report.png`：六项质量报告。
- `screenshots/07-confirmed-facts.png`：三类事实已确认。
- `screenshots/08-three-chapter-writing-desk.png`：三章写作台。
- `screenshots/09-writing-desk-mobile.png`：移动视口写作台。

## 已知限制

- 自动验收使用确定性 fake provider，只验证产品闭环、状态和检查器，不验证真实
  DeepSeek 的文本质量、延迟、限流和费用。
- 质量样本显示钩子、信息密度和人物声纹仍可提升，符合内部 beta 的人工打磨定位；
  不代表达到公开发布质量门槛。
- 性能只覆盖单作者、小样本、本地 Compose smoke；没有验证并发、300 万字、
  1000 章、备份恢复或云部署。
- 本任务未调用真实供应商，也未进行目标读者盲评、人工质量量表和发布合规检查。
- Linux、Safari、TLS、SMTP 生产邮件、对象存储恢复和灾备不在本次验收范围。

## 残余风险

- 真实模型的输出可能触发当前启发式检查器未覆盖的连续性、知识边界或质量问题。
- 真实 DeepSeek 的限流、费用和长上下文表现仍需在内部 beta 中持续采样。
- 多章连续写作依赖作者逐章确认事实；M1 尚不提供批量生产与审核队列。
- 角色状态写入、自由文本有效期和复杂时间线仍可能产生低风险边界冲突。
- 当前性能样本不能外推到多用户或超长作品。

## 验收中修复的缺陷

- **P1：设定编辑器旧请求覆盖新草稿。** 保存一个设定后立即点击“新建设定”，
  上一个保存流程延迟返回的详情刷新会把新草稿覆盖回旧条目，快速录入时可能重复
  提交旧名称并触发服务器错误。修复后，过期请求仍可刷新目录，但不能改写更新的
  选中项或编辑草稿。新增 `e2e/entities.spec.ts` 竞态回归测试；地图旅程连续
  重跑 5 次通过。

## 发布边界

M1 完成只表示仙侠题材可以进入内部 beta。它不是 V1 公开发布，不包含 M2 的
历史/都市题材、批量生产、任务中心、修改影响分析和平行版本，也不包含 M3 的
导出发布、安全合规、备份恢复和 V1 总验收承诺。
