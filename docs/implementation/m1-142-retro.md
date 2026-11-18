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

## 3. 后续环境项

- [Implementation frontier](../planning/implementation-frontier.md) 仍需独立同步 #142 已合并、#137/#138 deferred 和无 ready leaf 的真实状态。
- `scripts/download-gh-artifact.ps1` 仍使用单连接下载；容量大或网络受限时应增加分段并行与断点续传。

## 4. 导航

- 提交门禁实现：`scripts/validate-commits.mjs`
- 提交门禁回归测试：`scripts/test/commit-guardrails.test.mjs`
- 生产截图断言：`apps/web/e2e/parity/*.spec.ts`
- 截图契约：`docs/ui/production-visual-regression.md`
- 本地网络与 artifact 恢复：`docs/agents/local-environment-recovery.md`
