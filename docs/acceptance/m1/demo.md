# M1 内部连载演示

> M1 只面向内部 beta 验收。演示与自动验收全部使用确定性 fake provider，
> 不调用真实 DeepSeek，也不对外发布。

## 目的

用一条连续作者旅程证明一部仙侠作品可以走到可内部连载状态：

1. 完成并锁定九张卡片的故事圣经。
2. 建立世界、势力、人物、地图、力量体系、物品功法、时间线和剧情账本。
3. 建立全书、卷、幕、章、场景五层大纲，并确认生成准备度。
4. 在写作台按顺序生成三章，逐章保存版本。
5. 逐章确认事件、身体状况和角色认知，累计九条已确认设定。
6. 验证前一章事实进入后一章生成上下文。
7. 查看六项质量报告和连续性检查。
8. 检查桌面与移动端写作台，确认内部 beta 工作流完整。

## 安全边界

- Compose 的 API 和 Worker 必须设置 `AI_PROVIDER=fake`。
- 演示模型的 Base URL 使用不可达的 `http://127.0.0.1:9/openai-compatible`，
  API Key 使用本地占位值 `sk-m1-local-only`。
- fake provider 未生效时，生成会安全失败，不会回退到真实 DeepSeek。
- 不填写真实 API Key，不验证真实供应商的文本质量、限流或费用。

## 启动

在仓库根目录执行：

```powershell
$env:AI_PROVIDER = 'fake'
docker compose -p novel-brain-m1-acceptance up -d --build --wait
docker compose -p novel-brain-m1-acceptance ps
```

也可以使用一键演示脚本：

```powershell
pnpm demo:m1
```

已有健康 Compose 环境时可跳过重建：

```powershell
pnpm demo:m1 -- -SkipBuild
```

脚本会设置 fake provider、等待全部服务健康、检查 API 存活与就绪、运行
`e2e/m1-acceptance.spec.ts`、复制截图，并打印本次性能样本。需要隔离环境时设置
`$env:M1_COMPOSE_PROJECT`。

## 人工演示步骤

打开 http://localhost:3000，按以下顺序操作：

1. 创建作者账号。验证码从 http://localhost:8025 的 Mailpit 收件箱读取。
2. 新建仙侠长篇，填写笔名、规模“长篇”和目标平台。
3. 在故事圣经中补全九张卡片，保存并锁定。
4. 在设定中心建立沈砚、玄天宗、残剑、天门剑道和玄元纪年，补人物档案与状态。
5. 在地图与势力中建立世界到荒寺的层级，记录临渊城控制关系和人物行踪。
6. 建立三章完整大纲与第一章场景卡，刷新生成准备度。
7. 进入写作台，依次打开第 1、2、3 章，每章点击“根据章纲生成”。
8. 每章生成后保存版本，并确认事件、身体状况和角色认知。
9. 在“质量”页查看钩子、节奏、信息密度、人物声纹、文笔和连续性六项报告。
10. 在“连续性”页确认没有待处理的前后设定冲突，并检查下一章上下文已带入前序事实。

## 自动验收

```powershell
$env:AI_PROVIDER = 'fake'
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test e2e/m1-acceptance.spec.ts
```

截图默认写入 `test-results/m1-acceptance/`；`pnpm demo:m1` 会把它们复制到
`docs/acceptance/m1/screenshots/`。

## 截图

- `01-story-bible-locked.png`：九张卡片完整并锁定。
- `02-five-level-outline.png`：全书、卷、幕、章、场景大纲。
- `03-generation-readiness.png`：大纲、设定、已确认设定和模型 Key 就绪。
- `04-settings-center.png`：结构化设定中心。
- `05-map-and-faction.png`：分层地图、旅行时间与势力控制。
- `06-six-part-quality-report.png`：六项章级质量报告。
- `07-confirmed-facts.png`：本章三类事实均已确认。
- `08-three-chapter-writing-desk.png`：三章已生成并保存的桌面写作台。
- `09-writing-desk-mobile.png`：移动视口下的写作台，无横向溢出。

完整结果、性能样本、已知限制和 P0/P1 结论见 `acceptance.md`。
