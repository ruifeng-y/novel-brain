# M0 内部演示脚本

> M0 是 walking skeleton，只用于内部演示和架构验收，不是对外发布版本。
> 演示与自动验收都使用确定性 fake provider，不调用真实 DeepSeek。

## 目的

用一条连续的作者旅程证明 M0 已经贯通：

1. 注册、退出并重新登录。
2. 创建仙侠作品。
3. 保存一套 OpenAI 兼容格式的本地验收模型配置。
4. 保存最小故事圣经和第一章章纲。
5. 从章纲流式生成整章，保存章节版本。
6. 确认事件、身体状况和角色认知三类事实。
7. 在写作台看到连续性提示与已确认事实状态。

## 安全边界

- Worker 必须以 `AI_PROVIDER=fake` 启动。
- 演示模型 Base URL 填 `http://127.0.0.1:9/openai-compatible`，只用于证明配置和深色掩码可保存。
- 不点击真实供应商连接测试，不填写真实 API Key。
- 如果 fake provider 未生效，生成会尝试连接本地不可达地址并失败，不会回退到真实 DeepSeek。

## 启动

在仓库根目录执行：

```powershell
$env:AI_PROVIDER = 'fake'
docker compose up -d --build
docker compose ps
```

等待 `api`、`postgres`、`redis`、`mailpit`、`minio`、`worker`、`web` 和 `caddy` 健康。

也可以用一键演示脚本：

```powershell
pnpm demo:m0
```

脚本会设置 fake provider、重建并等待 Compose 服务、运行 M0 验收 Playwright，然后打印截图路径。
需要隔离一套 Compose 环境时，先设置 `$env:M0_COMPOSE_PROJECT`；已有健康服务时
可追加 `-- -SkipBuild` 跳过重建。

## 演示步骤

打开 http://localhost，按下面顺序操作：

1. 创建作者账号。验证码从 http://localhost:8025 的 Mailpit 收件箱读取。
2. 退出登录，再用同一邮箱和密码登录。
3. 打开“模型设置”，把配置名称填为“M0 本地验收模型”，Base URL 填 `http://127.0.0.1:9/openai-compatible`，模型名填 `deepseek-chat`，用途选“正文”。保存后确认 Key 只显示掩码。
4. 返回“作品书架”，创建一部仙侠长篇。
5. 保存故事圣经：一句话故事、主角、世界铁律。
6. 保存第一章章纲：章目标、叙事视角、场景节拍、章末钩子。
7. 进入写作台，点击“根据章纲生成”。观察正文流式出现，生成完成后保存版本。
8. 在“本章事实”里分别确认事件、身体状况和角色认知，确认状态变为“3 条已确认”。
9. 查看“连续性提示”。本验收章应显示“这一章暂时没有发现身体状态冲突。”的可见状态。

## 自动验收

```powershell
$env:AI_PROVIDER = 'fake'
pnpm test:e2e --grep "M0 acceptance"
```

完整 Playwright 套件会额外使用本地模型桩验证连接测试。Compose API 默认通过
`host.docker.internal` 访问它；若 API 直接跑在宿主机上，先设置
`$env:MODEL_PROVIDER_STUB_HOST = '127.0.0.1'`。
CI 使用已经启动的 Compose 栈，并设置 `PLAYWRIGHT_SKIP_WEBSERVER=1`，避免
Playwright 再启动一套 Web。

普通 Playwright 运行会把截图写入已忽略的 `test-results/m0-acceptance/`，不会弄脏
工作区。运行 `pnpm demo:m0` 时，脚本会在验收通过后把截图复制到
`docs/acceptance/m0/screenshots/`：

- `01-model-settings.png`
- `02-story-bible-and-outline.png`
- `03-streaming-chapter.png`
- `04-confirmed-facts.png`
- `05-continuity-state.png`

完整结果、环境、已知限制和 P0/P1 结论见 `docs/acceptance/m0/acceptance.md`。
