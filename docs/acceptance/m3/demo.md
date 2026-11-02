# M3 / V1 发布候选演示

> 本演示用于 M3 发布候选和 V1 总验收。自动测试全部使用确定性 fake provider，
> 不调用真实 DeepSeek，也不代表 V1 已获公开发布批准。

## 目的

用一条可重复的本地门禁确认：

1. 干净 Compose 项目能启动 Caddy、web、api、worker、Postgres、Redis、Mailpit
   和 MinIO。
2. API 存活、就绪和迁移/seed 正常。
3. 导出、发布检查、读者预览、法律页面和移动视口可用。
4. 账号生命周期、审计、完整导出、作品回收站和 30 天清理可用。
5. 工作级资料、封面上传、一句话/空白创建、大纲和历代版本导出可用。
6. 全量 Vitest、Playwright、性能、安全和恢复证据可由同一分支复现。

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
$env:M3_COMPOSE_PROJECT = 'novel-brain-v1-acceptance-8f376a5'
pnpm demo:m3 -- -SkipBuild
```

运行完整 Playwright 而不是 M3 子集：

```powershell
pnpm demo:m3 -- -SkipBuild -Full
```

脚本会：

1. 设置 fake provider 并启动 8 个 Compose 服务。
2. 检查 API 存活和就绪。
3. 运行 M3 导出、发布检查、合规和响应式 Playwright。
4. 打印内部 RC / 公开发布边界。

## 手工演示

打开 http://localhost，按以下顺序操作：

1. 注册作者账号，验证码从 http://localhost:8025 读取。
2. 创建仙侠作品，填写章纲并写三章正文。
3. 试一次一句话想法和空白作品创建，打开作品资料补目标读者、章节字数、节奏、
   风格样本、禁忌、简介、标签和封面。
4. 打开“导出与平台预设”，切换 TXT/Markdown/DOCX/EPUB、通用/起点/番茄，
   预览目录并下载。
5. 导出大纲 Markdown/JSON，并从版本历史导出一个历史版本 ZIP。
6. 打开“发布准备”，生成书名/简介/标签/章节名建议，查看读者预览，运行六项
   发布检查并复制/下载报告。
7. 打开“账号设置”，测试找回密码、修改资料、多笔名、邮箱/密码变更和注销恢复入口。
8. 打开“隐私与合规”，完成一次完整账号导出并查看账号审计。
9. 在作品书架导入旧稿、归档、移入回收站、恢复和复制作品；确认完本作品只读。
10. 打开隐私与合规、隐私政策、用户协议和 AI 内容标识页面。
11. 把视口调到 390px，确认没有横向溢出。

## 完整门禁

```powershell
pnpm lint
pnpm typecheck --force
pnpm test
pnpm build --force
$env:AI_PROVIDER = 'fake'
docker compose -p novel-brain-v1-acceptance-8f376a5 up -d --build --wait
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test --workers=4
```

性能、安全和恢复复现见 `docs/acceptance/m3/acceptance.md` 和
`docs/release/v1-migration-rollback-runbook.md`。

## 结果边界

本演示通过表示 B-01/B-02/B-03/B-04/B-07/B-12/B-13 工程门槛和本地自动化门禁通过，
可作为局域网/内部发布候选。B-05 人工质量、B-06 真实 DeepSeek、B-08 法务和
B-07 live cloud 证据仍未闭环，详见 `acceptance.md` 和
`docs/release/v1-known-limitations.md`。
