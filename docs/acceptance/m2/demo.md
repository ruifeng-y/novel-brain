# M2 扩大 beta 演示

> M2 用于内部扩大测试。演示和自动验收全部使用确定性 fake provider，不调用真实
> DeepSeek，也不对外发布。

## 目的

用一条连续作者旅程证明：

1. 仙侠、历史、都市作品都能创建。
2. 历史与都市题材包能进入章节生成上下文。
3. 仙侠作品可以创建批量任务，进入审核队列并完成批准或送写作台。
4. 修改请求能完成影响分析和六项一致性检查，并应用、撤销。
5. 可从已保存正文版本创建平行版本并并排比较。
6. 可回滚到正文版本，回滚同时恢复设定、大纲、正文和已确认内容。
7. 审计记录可搜索并导出。

## 安全边界

- API 和 Worker 必须以 `AI_PROVIDER=fake` 启动。
- 验收模型 Base URL 使用不可达的 `http://127.0.0.1:9/openai-compatible`。
- 验收 Key 使用本地占位值 `sk-m2-local-only`。
- fake provider 未生效时，生成会安全失败，不会回退到真实 DeepSeek。

## 一键演示

在仓库根目录执行：

```powershell
pnpm demo:m2
```

已有健康的隔离 Compose 环境时可跳过重建：

```powershell
pnpm demo:m2 -- -SkipBuild
```

需要指定其他 Compose 项目名时设置 `$env:M2_COMPOSE_PROJECT`。脚本会：

1. 设置 fake provider 并启动 8 个 Compose 服务。
2. 等待 API、Worker、Web、Postgres、Redis、MinIO、Mailpit 和 Caddy 健康。
3. 检查 API 存活与就绪。
4. 运行 `e2e/m2-acceptance.spec.ts`。
5. 把截图和 `metrics.json` 复制到本目录。
6. 打印本次性能 smoke 样本和扩大 beta 提醒。

## 人工演示步骤

打开 http://localhost，按以下顺序操作：

1. 创建作者账号。验证码从 http://localhost:8025 的 Mailpit 收件箱读取。
2. 新建仙侠、历史和都市作品，确认题材、主模板和历史方向显示正确。
3. 为历史作品打开“历史规则检查”，试写现代器物或越级军令，确认时代错置和距离提示。
4. 为都市作品查看城市、公司、家族、阶层、法律、金钱和人脉设定子类型。
5. 在仙侠作品中建立两章章纲，进入写作台，打开“创作任务”。
6. 选择自定义区间，创建包含两章的批量任务，等待审核队列出现两章。
7. 批准第一章，把第二章送到写作台，确认正文可继续编辑。
8. 打开“修改请求”，补充一个地点旧称，确认影响分析显示“可以直接应用”和六项检查。
9. 应用修改，再撤销这次修改，确认撤销也产生新的版本记录。
10. 保存两个正文版本，从较早版本创建平行版本，检查并排比较。
11. 在版本图里回到较早正文版本，填写回滚原因，确认正文与相关状态一起恢复。
12. 搜索“撤销”或“回滚”操作记录，并导出 CSV。

## 自动验收

```powershell
$env:AI_PROVIDER = 'fake'
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
pnpm exec playwright test e2e/m2-acceptance.spec.ts
```

完整结果、命令清单、缺陷和残余风险见 `acceptance.md`。

## 截图

- `screenshots/01-three-genre-bookshelf.png`：三题材作品和 M2 扩大 beta 标识。
- `screenshots/02-history-rules.png`：历史题材规则与设定界面。
- `screenshots/03-batch-task-center.png`：批量任务详情和章节进度。
- `screenshots/04-review-queue.png`：待审核章节队列。
- `screenshots/05-change-impact.png`：修改差异、影响范围和六项检查。
- `screenshots/06-parallel-version.png`：平行版本与并排比较。
- `screenshots/07-version-rollback.png`：版本图、审计搜索和回滚结果。
