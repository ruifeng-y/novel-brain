# M2 复盘与下一阶段前沿

> 日期：2026-11-12
> 基线：`main@024e4ea`，PR #185
> 性质：流程与环境复盘，不重新定义产品范围

## 1. 结果

- PR #185 将 M2 集成到 `main`，Production CI、Playwright、OpenAPI、migration、unit 和 integration 全部通过。
- PR #167 的提前合并已由 PR #184 撤回；最终实现通过 #185 重新集成，没有保留被撤回的提交状态。
- M2 的 `#91–#97` 与 `#120–#128` 已关闭。

## 2. 暴露的问题

- GitHub PR 自动合并可能在替代 PR 合并后立即把旧 stacked PR 合入；撤回前必须先关闭自动合并。
- 本地 Windows Golden 不能替代 Linux baseline；正式 Golden 必须来自精确 source SHA 的 `update_golden` artifact。
- 视觉工作流失败曾来自非视觉门禁，例如提交信息语言和格式化；应先通过本地交付预检，再触发昂贵 Linux 任务。
- 多个 M1 叶子已经进入集成树，但 issue 状态仍为 OPEN，导致 dependency graph 把已完成工作误判为下一前沿。
- 全量 integration 并行运行时曾因 PostgreSQL `TRUNCATE users CASCADE` 竞争而超时；重跑和串行失败文件通过，最终以 CI 全量结果为准，但仍需要观察稳定性。
- 合并后本地 worktree 仍停在旧分支；远端分支删除不等于本地 worktree 清理。

## 3. 已固化到环境

- `docs/planning/implementation-frontier.md` 更新到 M2 完成后的真实状态。
- `docs/ui/production-visual-regression.md` 增加 Linux Golden artifact 恢复流程。
- `docs/agents/issue-tracker.md` 增加 PR 撤回、自动合并和 tracker reconciliation 规则。
- `docs/implementation/README.md` 指向当前 frontier 和本复盘。

## 4. 下一阶段决策

1. 先做 M1 tracker reconciliation：以 `docs/implementation/m1-spec-closeout.md`、当前 `main` 代码和正式 Golden 为依据，关闭已完成的叶子票；结果见 `docs/planning/m1-tracker-reconciliation.md`。
2. 保留 #162、#165、#166 为真实代码阻塞，不在核账时误关。
3. M1 状态稳定后进入 #132，完成 M0–M2 全租户表 RLS、授权和审计清单。
4. #132 完成后再进入 #133；不提前开始 M3 导出或发布功能。

## 5. 验证

- `pnpm format:check`
- `pnpm check:pr`
- `node scripts/validate-readiness.mjs`
- 正常 Production CI
