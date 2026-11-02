# M3 / V1 发布候选演示

> 本演示用于 M3 发布候选和 V1 总验收。自动测试全部使用确定性 fake provider，
> 不调用真实 DeepSeek，也不代表 V1 已获公开发布批准。

## 目的

用一条可重复的本地门禁确认：

1. 干净 Compose 项目能启动 Caddy、web、api、worker、Postgres、Redis、Mailpit
   和 MinIO。
2. API 存活、就绪和迁移/seed 正常。
3. 导出、发布检查、读者预览、法律页面和移动视口可用。
4. 全量 Vitest、Playwright、性能、安全和恢复证据可由同一分支复现。

## 安全边界

- API 和 Worker 必须以 `AI_PROVIDER=fake` 启动。
- 验收模型 Base URL 使用不可达的 `http://127.0.0.1:9/openai-compatible`。
- 验收 Key 使用本地占位值，不写真实供应商 Key。
- fake provider 未生效时生成应安全失败，不得回退到真实 DeepSeek。

## 一键演示

```powershell
pnpm demo:m3
```

已有健康的隔离 Compose 环境时可跳过重建：

```powershell
$env:M3_COMPOSE_PROJECT = 'novel-brain-v1-acceptance'
pnpm demo:m3 -- -SkipBuild
```

运行完整 Playwright 而不是 M3 子集：

```powershell
pnpm demo:m3 -- -SkipBuild -Full
```

脚本会：

1. 设置 fake provider 并启动 8 个 Compose 服务。
2. 检查 API 存活和就绪。
3. 运行导出、发布检查、合规和响应式 Playwright。
4. 打印 V1 发布候选提醒和未闭环范围。

## 手工演示

打开 http://localhost，按以下顺序操作：

1. 注册作者账号，验证码从 http://localhost:8025 读取。
2. 创建仙侠作品，填写章纲并写三章正文。
3. 打开“导出与平台预设”，切换 TXT/Markdown/DOCX/EPUB、通用/起点/番茄，
   预览目录并下载。
4. 打开“发布准备”，生成书名/简介/标签/章节名建议，查看读者预览，运行六项
   发布检查并复制/下载报告。
5. 打开隐私与合规、隐私政策、用户协议和 AI 内容标识页面。
6. 把视口调到 390px，确认没有横向溢出。

## 完整门禁

```powershell
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

性能、安全和恢复复现见 `docs/acceptance/m3/acceptance.md` 和
`docs/release/v1-migration-rollback-runbook.md`。

## 结果边界

本演示通过只表示 M3 发布候选的本地功能、性能和恢复门禁通过。质量盲评、真实
DeepSeek、账号生命周期、完整审计/导出、TLS/静态加密/日志保留和法务确认仍未
闭环，详见 `acceptance.md` 和 `docs/release/v1-known-limitations.md`。
