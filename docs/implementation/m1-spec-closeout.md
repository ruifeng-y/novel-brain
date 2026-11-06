# M1 Spec 集成验收记录

> Spec: #80 完整仙侠创作闭环
> Integration branch: `codex/m1-full-loop`
> HEAD: `2f39b98`
> 日期: 2026-11-06

## 已集成范围

- Story Bible / Settings: #143、#144
- World simulation: #106、#107、#108
- Outline / ledgers: #145、#146
- Golden Three / readiness: #147、#148
- Agent Runtime: #109–#115
- Writing / critique / revision / style: #116–#119
- Account completion: #141
- M1 volume audit and full-loop acceptance: #90

所有叶子 ticket 均通过各自的功能提交和 merger commit 进入同一 integration branch；没有引入微服务、第二版本图或 Web 直连模型。

## 最终自动化证据

- `pnpm check`: format、lint、typecheck、250 项单元/契约测试通过。
- `pnpm test:integration`: 25 个文件、142 项真实 PostgreSQL/Redis 集成测试通过。
- `pnpm exec playwright test --grep-invert "checks every M0 parity page"`: 93 项通过，覆盖全部 M1 页面四档视口、M1 全链路、M0 回归旅程、作者语言和后端故障恢复。
- `pnpm --filter @novel-brain/api openapi:check`: 通过。
- `node scripts/validate-readiness.mjs`: 通过。

## 已修复的整体审查问题

- 无新鲜质量报告时禁止批准章节和提交事实，P0/P1 继续阻断。
- 黄金三章增加真实 3 候选生成入口与 provenance/版本 pin。
- 锁定设定修改请求返回并展示影响资源提示。
- M1 全链路 Playwright 改为真实 UI 主路径，不再只依赖 API fixture 展示。
- 新增 API 列表游标分页、创建幂等键、撤销版本校验和统一 tenant transaction helper。
- 修复 canon 同章新幂等键/新章节版本误返回旧提交的问题。
- 统一质量/审计严重度文案，并同步 prototype contract。

## 尚未完成的人工/后续门禁

- M1 页面生产 golden 仍需按 ADR 0027 重新拍摄和作者签收：bible、settings、entity-detail、outline、foreshadows、writing、work-overview、account-settings。#143 保持未关闭。
- M0 golden 截图用例未纳入本次“全绿”计数，因为其基线仍是旧页面；需与 M1 golden 一起重新签收。
- #142 作品设置/归档恢复/复制仍被 #134 的永久删除与生命周期契约阻塞；本分支未绕过该依赖实现不可逆删除。
- 真实 DeepSeek 仍只走独立 gated smoke，不进入普通测试套件。
