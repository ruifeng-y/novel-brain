# M3-05 合规与安全检查验收映射

本文把 GitHub issue #32 的五条验收标准映射到作者页面、运行清单、法务记录和可执行证据。

| 验收标准 | 作者侧入口 | 运行/法务文档 | 自动化证据 | 状态 |
| --- | --- | --- | --- | --- |
| 隐私政策和用户协议覆盖数据、模型供应商和删除 | `/legal/privacy`、`/legal/terms`、`/workspace/settings/privacy` | `docs/operations/security-backup.md`、本目录法务待确认项 | `e2e/compliance.spec.ts` | 通过 |
| AI 生成内容标识说明可用 | `/legal/ai-content`、`/workspace/settings/privacy` | `docs/operations/content-moderation.md` | `e2e/compliance.spec.ts` | 通过 |
| 内容审核和安全检查清单完成 | 作者侧发布提醒不展示内部流程 | `docs/operations/content-moderation.md`、`docs/operations/security-checklist.md` | 安全测试与审计归档 | 通过 |
| 法务待确认项有明确负责人 | 不展示内部负责人信息 | `docs/compliance/legal-pending-items.md` | 人工复核 | 通过 |
| 安全测试和审计记录归档 | 不展示测试细节 | `docs/acceptance/m3/security-audit.md`、`docs/acceptance/m3/security-audit/2026-11-02.json` | 安全 18/18、全量 157/157、build 7/7、Playwright 30/30、依赖审计 high 门槛通过 | 通过 |

## 明确不在本 ticket 内

- 不实现账号注销入口和 30 天清理任务；政策只记录已确认的产品承诺，实现由 L-07 在公开发布前闭环。
- 不实现产品内管理员后台、内容审核后台或人工审核队列 UI。
- 不接入真实小说平台，也不替作者发布或自动填写平台标签。
- 不替代法务对运营主体、备案、责任限制和供应商条款的正式意见。
- 不把本地 Docker Compose 的 HTTP 配置视为公网生产配置。
