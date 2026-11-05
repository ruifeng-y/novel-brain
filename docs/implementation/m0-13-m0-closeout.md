# M0-13 全链路、UI Parity、安全与真实模型验收

> Issue: #79
> Parent spec: #66
> Capability IDs: UI-001–UI-009, OPS-001, EVAL-001, EVAL-003

## 实现范围

- 新增一条生产 UI 全链路 E2E：注册 → 配置 Key → 一句话开书 → 故事圣经生成/锁定 → 章纲 → 章节生成 → 事实确认/驳回 → 章节批准 → 事实提交 → 已确认设定更新。
- 新增 M0 九页集中验收：auth、dashboard、new-project、account-settings、work-overview、bible、settings、outline、writing 在 390/900/1180/1440 下截图、无横向溢出并通过作者语言扫描。
- 扩展现有作者语言扫描，禁止内部术语 `Agent`、`Canon`、`Context Pack`、`P0–P4`、`正史`、`故事事实`、`版本节点`、`版本头`、`main` 和内部表名。
- 新增真实 DeepSeek gated smoke seam。缺少 `DEEPSEEK_API_KEY` 时只记录 `skipped`，不访问网络、不打印凭据；存在凭据时记录生成结果哈希、模型、token、延迟和成本轨迹。
- 将 Worker 与 DeepSeek smoke 共用同一 M0 token 成本估算常量。
- 新增非技术作者演示脚本：`docs/demo/m0-author-demo.md`。

## 五个开书入口证据

| 入口 | E2E 测试 |
| --- | --- |
| 一句话想法 | `apps/web/e2e/parity/new-project.spec.ts`：`creates a work from an idea and opens its overview` |
| 空白作品 | `apps/web/e2e/parity/new-project.spec.ts`：`creates a blank work without an idea` |
| 题材模板 | `apps/web/e2e/parity/new-project.spec.ts`：`creates a xianxia template work` |
| 设定导入 | `apps/web/e2e/parity/new-project.spec.ts`：partial/complete settings tests 与 conflict gate |
| 旧稿导入 | `apps/web/e2e/parity/new-project.spec.ts`：manuscript split/merge/confirm tests |

## 跨用户隔离证据

| 数据面 | 集成测试 |
| --- | --- |
| 作品 | `apps/api/test/works.integration.test.ts`：`lists, searches, filters and paginates works for the current tenant only` |
| 故事圣经 | `apps/api/test/story-bible.integration.test.ts`：`keeps the nine-card invariant, rejects invalid updates and isolates tenants` |
| 设定 | `apps/api/test/settings.integration.test.ts`：tenant isolation assertions |
| 章节 | `apps/api/test/chapters.integration.test.ts`：`rejects cross-tenant chapter reads and saves` |
| 事实 | `apps/api/test/facts.integration.test.ts`：`rejects cross-tenant chapter approval and fact submission` 及事实决策隔离 |
| 模型配置 | `apps/api/test/auth.integration.test.ts`：`rejects SSRF targets and cross-user model configuration access` |

以上测试均在公共 HTTP 边界断言 `FORBIDDEN_TENANT_ACCESS`，不依赖内部仓储调用。

## 确定性 Fake Provider

- `packages/ai/test/fake-provider.test.ts` 将 `fetch` 替换为抛错函数，确认 fake provider 不访问网络且相同输入产生相同结果。
- API/Worker 集成测试直接注入 `FakeAiProvider`，覆盖生成、失败、预算和断点恢复，不使用真实网络。
- `packages/ai/src/smoke.ts` 在 smoke 运行期间把 `fetch` 替换为禁止网络函数。

## 真实 DeepSeek 证据

命令：

```bash
pnpm smoke:deepseek
```

行为：

- 只检查 `DEEPSEEK_API_KEY` 是否存在，不输出其值。
- 缺少凭据时写入 `artifacts/playwright/deepseek-smoke.json`，状态为 `skipped`，`networkCalls` 为 `0`。
- 存在凭据时调用 DeepSeek 官方兼容接口，记录 `textHash`、`textLength`、模型、token、延迟、成本估算和 provider response ID。
- 演示前强制要求真实证据时设置 `REQUIRE_DEEPSEEK_SMOKE=1`；缺少凭据会以失败退出。
- 2026-11-05 已使用真实凭据完成一次 smoke：模型 `deepseek-flash`，网络调用 1 次，45 tokens，延迟 918ms，估算成本 ¥0.00009，provider response ID `94eea13d-3784-4e0b-a6ac-83aa08368fa7`。证据只记录文本哈希与长度，不记录 Key 或生成正文；脱敏记录见 `docs/implementation/evidence/deepseek-smoke-2026-11-05.json`。

## UI Parity 状态

自动化证据覆盖全部 M0 页面和四档视口。2026-11-05 作者已对照初始生产截图并签收 M0 九页 golden baseline；36 张生产截图已提交到 `artifacts/ui/golden/`，并由 `m0-closeout.spec.ts` 以 0.5% 像素差异容忍度进行回归比对。Linux/Chromium 基线更新证据：[Production CI #42005502769](https://github.com/ruifeng-y/novel-brain/actions/runs/42005502769)。

因此 auth、dashboard、new-project、account-settings、work-overview、bible、settings、outline、writing 已标记为 `parity-verified`。M1–M3 页面仍需按 ADR 0027 单独完成生产截图、比对和作者签收。

## 验证结果

- `pnpm check`：7 个测试文件、40 项测试通过；格式、lint、类型检查通过。
- `pnpm test:integration`：9 个集成测试文件、55 项测试通过。
- `pnpm test:e2e`：59 项 Playwright Chromium 测试通过，包含全链路、M0 九页 × 四档视口和页面状态补充断言。
- `pnpm --filter @novel-brain/api openapi:check`：OpenAPI 与生成类型无漂移。
- `node scripts/validate-readiness.mjs`：119 个能力、119 个主 issue 映射、85 节点依赖图通过。
- `pnpm stack:smoke`：Web、API readiness、Mailpit、Postgres、Redis 和 Worker 消费队列通过。
- `pnpm smoke:deepseek`：真实凭据 smoke 成功，记录 `networkCalls: 1`、token、延迟、成本和脱敏文本哈希。

## 待补证据与风险

- Docker 镜像重建在 Corepack 下载 pnpm 时停滞；stack smoke 使用已有镜像完成服务级检查，当前源码由本地 check、integration 和 E2E 验证。
- M1–M3 生产页面的 golden 截图与签收仍待各自页面 ticket 完成。
