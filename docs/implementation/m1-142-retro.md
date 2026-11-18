# M1-142 Agent 交付复盘

> 日期：2026-11-18
> 关联：Issue #212、PR #211、旧 PR #210
> 性质：agent 环境与交付反馈回路，不改变产品行为

## 1. 暴露的问题

- 提交信息门禁把简体中文正文中的常规项目技术词当成英文正文。PR #210 的一个合法中文提交因此失败，最终只能关闭旧 PR 并从干净分支重建 PR #211。
- 多视口截图使用 fail-fast 断言。首个失败视口会立即终止当前测试，隐藏后续视口的截图差异，导致额外的 Linux Production CI 往返。

## 2. 已落地的环境改进

- `scripts/validate-commits.mjs` 的技术词表补充 `Golden`、`dashboard`、`work-settings`、`parity`、`actual`、`Chromium` 等实际项目词汇。
- `scripts/test/commit-guardrails.test.mjs` 固化 PR #210 的真实失败正文，防止同一误判回归。
- `apps/web/e2e/parity/*.spec.ts` 的截图比较统一使用 `expect.soft(page).toHaveScreenshot(...)`，让一次测试运行继续检查后续视口并保留全部 diff artifact。

## 3. P2 环境同步

Issue #214 完成后续环境项：

- #142 收口时，[Implementation frontier](../planning/implementation-frontier.md) 曾同步 #142 已合并、#137/#138 deferred 和无 ready leaf 的真实状态；后续 #138 已恢复实现并记录独立 full/maximum benchmark 证据。
- `scripts/download-gh-artifact.ps1` 对大 artifact 使用可恢复的分段并行下载；失败 chunk 保留供重试，成功后校验总大小并解包。

验证使用 Production CI run `44228905270` 的 `playwright-evidence` artifact：

- artifact ID：`14395232453`
- GitHub metadata 大小与下载结果：`87515636` bytes
- `-MetadataOnly`：通过
- `-Parallelism 8`：通过，8 个分段全部完成；运行中的 8 个 `curl.exe` 参数均不含 token
- 完整文件重跑：`-Parallelism 1` 在长度、sidecar SHA-256 和 zip entry 均有效时直接复用，不再发出无效 range 请求
- 同长度损坏 zip：内容损坏导致 sidecar 哈希不匹配后未被复用，脚本重新下载并通过解包
- 工作区外 destination：按预期拒绝且未创建目录
- Junction 逃逸：按预期拒绝且目标目录未创建
- 崩溃续传：注入 chunk 0 的 1 MB `.part` 和 meta，只下载剩余字节；最终 zip SHA-256 与完整下载一致，为 `12CA9656635DB592A4FEF54FC7853D8792A98CB7162DA0D3BACC078BD1D13563`
- 解包目录：`artifacts/playwright/retro-214-download/`
- 成功后分段目录已清理

## 4. 导航

- 提交门禁实现：`scripts/validate-commits.mjs`
- 提交门禁回归测试：`scripts/test/commit-guardrails.test.mjs`
- 生产截图断言：`apps/web/e2e/parity/*.spec.ts`
- 截图契约：`docs/ui/production-visual-regression.md`
- 本地网络与 artifact 恢复：`docs/agents/local-environment-recovery.md`
