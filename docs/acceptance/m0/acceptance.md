# M0 端到端验收记录

> 结论：M0 walking skeleton 的端到端验收通过。M0 只用于内部演示，不是公开
> 发布版本。本记录没有发现 P0 或 P1 产品缺陷。

## 范围

本记录覆盖 GitHub issue #10「M0-09 端到端验收」：

1. 注册、退出并重新登录。
2. 创建仙侠作品。
3. 保存 OpenAI 兼容格式的本地验收模型配置。
4. 保存最小故事圣经和第一章章纲。
5. 从章纲流式生成整章并保存版本。
6. 确认事件、身体状况和人物认知事实。
7. 在写作台看到连续性提示和已确认事实状态。
8. Docker Compose 在全新项目名和全新数据卷下启动、迁移、seed 和冒烟。

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
| 干净 Compose 项目 | `novel-brain-m0-acceptance` |

验收模型的 Base URL 为 `http://127.0.0.1:9/openai-compatible`，API Key 为
`sk-m0-local-only`。该地址故意不可达；若 fake provider 没有生效，生成会安全失败，
不会回退到真实 DeepSeek。

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

结果：通过，7 个测试文件，40/40 个 Vitest 测试。

```powershell
pnpm build --force
```

结果：通过，7/7 个包构建成功，0 个缓存命中。

```powershell
docker compose -p novel-brain-m0-acceptance config --format json
docker compose -p novel-brain-m0-acceptance build --no-cache
$env:AI_PROVIDER = 'fake'
docker compose -p novel-brain-m0-acceptance up -d --wait
```

结果：通过。Docker 构建缓存全部绕过；全新网络和全新 Postgres/MinIO/Caddy 数据卷
创建成功，8 个服务全部 healthy；API 启动时执行迁移和 seed，`system_jobs` 的
seed 数据为 2 条，初始 `works` 为 0。

```powershell
Invoke-WebRequest http://127.0.0.1/
Invoke-RestMethod http://127.0.0.1/api/v1/health
Invoke-RestMethod http://127.0.0.1/api/v1/health/ready
```

结果：

- Web HTTP 200。
- 存活检查 `status=ok`。
- 就绪检查 `database=up`、`redis=up`、`objectStorage=up`。
- MinIO live 返回 HTTP 200。
- Mailpit API 可读，初始消息数 0。

```powershell
$env:AI_PROVIDER = 'fake'
$env:CI = '1'
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
pnpm test:e2e
```

结果：通过，9/9 个 Playwright 测试；其中
`e2e/m0-acceptance.spec.ts` 用一条浏览器旅程完成全部 M0 主路径。
这组环境变量复现 CI 路径：浏览器直接连接已经健康的 Compose Web，不再另起 dev server。

```powershell
$env:M0_COMPOSE_PROJECT = 'novel-brain-m0-acceptance'
pnpm demo:m0 -- -SkipBuild
```

结果：通过，内部演示脚本确认 8 个服务健康，M0 验收 Playwright 1/1 通过，并打印
稳定截图路径。

验收后查询干净数据库，确认数据实际落盘：

- `works = 5`
- `chapters = 4`
- `chapter_versions = 2`
- `facts = 5`
- `canon_commits = 5`
- `jobs = 5`，其中 `completed = 4`；唯一失败任务来自既有生成失败恢复场景。

Worker 运行环境确认包含 `AI_PROVIDER=fake`。

## 验收标准映射

| Issue #10 标准 | 证据 |
| --- | --- |
| Playwright happy path 从注册走到事实确认 | `e2e/m0-acceptance.spec.ts`；注册、登录、建作品、配模型、故事圣经、章纲、流式生成、保存版本、三类事实确认、刷新后仍可见 |
| 所有 M0 验收标准通过，没有 P0 或 P1 缺陷 | lint、typecheck、40 个 Vitest、7 包构建、9 个 Playwright 全部通过；未发现 M0 产品缺陷 |
| 内部演示脚本和截图完成 | `docs/acceptance/m0/demo.md`、`scripts/m0-demo.ps1`、`docs/acceptance/m0/screenshots/` |
| Docker Compose 和测试在干净环境可重复 | 全新项目 `novel-brain-m0-acceptance`、全新数据卷、健康检查、HTTP 冒烟和完整 Playwright 通过 |
| 明确记录 M0 不对外发布 | 本目录 README、演示脚本、验收记录和根 README 均明确 M0 是内部 walking skeleton |

## 截图

- `screenshots/01-model-settings.png`：模型配置已保存且 Key 仅显示掩码。
- `screenshots/02-story-bible-and-outline.png`：最小故事圣经与第一章章纲。
- `screenshots/03-streaming-chapter.png`：生成中的流式正文状态。
- `screenshots/04-confirmed-facts.png`：三类事实均为已确认。
- `screenshots/05-continuity-state.png`：连续性提示面板状态。

## 已知缺口与残余风险

- 自动验收使用确定性 fake provider，不验证真实 DeepSeek 的文本质量、限流和费用。
- 模型连接测试用本地 OpenAI 兼容桩验证协议和掩码；真实供应商连接需要作者自己的 Key。
- 干净环境验证在 Windows 11 + Docker Desktop 上完成；未在本任务中验证 Linux CI、
  TLS、备份恢复或云部署。
- M0 不包含完整设定中心、地图、批量生产、修改影响分析、平行版本、导出和发布能力。
- M0 不提供公开发布所需的安全、合规、性能或恢复承诺。

## 验证中处理的测试环境问题

- 旧 Compose web 镜像早于编辑器高亮修复，导致首次全量 Playwright 出现假失败；
  从当前源码重建镜像后通过。
- 模型连接测试原先把容器内 API 指向测试进程的 `127.0.0.1`；改为本地桩监听
  `0.0.0.0`，Compose API 通过 `host.docker.internal` 访问，并在 compose 中声明
  `host-gateway`。宿主机直接运行 API 时可用
  `$env:MODEL_PROVIDER_STUB_HOST = '127.0.0.1'`。
