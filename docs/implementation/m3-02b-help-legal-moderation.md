# M3-02b 帮助、法律内容、AI 标识与申诉

> Issue: #131
> Capability: SEC-005
> Status: implemented; owner legal draft reviewed and production visual signed off

## 1. 实现范围

- 新增无需作品上下文的 `/help`、`/legal` 和 `/legal/{terms|privacy|ai-disclosure}` 生产路由，并提供运行错误边界与帮助搜索空状态。
- 法律内容集中保存在 `apps/web/content/legal-copy.json`，2026-11-17 已由负责人复核确认运营前草案。正式公开上线前仍需补齐运营主体、联系渠道、适用地域和争议处理条款。
- 新增法务文案扫描，检测无依据的隐私、训练和安全承诺。实际文案与负例测试均由 `scripts/test/legal-copy-guardrails.test.mjs` 覆盖。
- 导出 manifest 升至 `schemaVersion: 2` 并新增 `aiDisclosureMetadata`，固定 `ai-disclosure-v1`、作者可读标签和作品级要求；TXT/Markdown/DOCX/EPUB 正文、版本清单、发布文案和重新导出都保留该标识。旧 `schemaVersion: 1` 仍可读取下载，但发布检查缺少当前元数据时 fail closed。
- 发布检查读取导出清单中的 AI 标识元数据，并在检查证据中展示说明、规则版本和要求状态。
- 新增内容安全记录与申诉 API。发布预览从 `content_safety_review` 固定规则版本、证据、涉及章节和 `clear`/`needs_review` 状态。
- 申诉提交、幂等重放、撤回、状态变化与审计事件均按租户范围保存；内容提示不会按关键词自动封禁。

## 2. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/works/:workId/branches/:branchId/moderation-cases` | 内容安全记录、证据和申诉事件 |
| POST | `/api/v1/works/:workId/branches/:branchId/moderation-cases/:caseId/appeals` | 提交申诉或纠正说明，必须带 `Idempotency-Key` |
| POST | `/api/v1/works/:workId/branches/:branchId/moderation-cases/:caseId/appeals/:appealId/withdraw` | 撤回待处理申诉 |

## 3. 数据与安全

- 新增 `works.ai_disclosure_required`、`moderation_cases`、`moderation_appeals`、`moderation_events`。
- 三张 moderation 表启用并强制 tenant RLS，repository 查询显式携带 `user_id/work_id/branch_id`，并设置 `SET LOCAL app.user_id`。
- 申诉提交使用 24 小时 `Idempotency-Key`。同一 key 不同请求返回稳定冲突；同 key 重放返回首次提交时的固定案件快照，不重复追加事件，也不会被后续撤回改写。
- 申诉事件为 append-only UI 可读审计，事件带 `appealId`；撤回只更新当前申诉状态并追加事件，不删除历史。单案最多保留 20 次申诉，避免事件无界增长。
- 内容安全证据只保存本地规则提示词、章节编号和规则版本，不保存命中的整段正文，也不把本地提示写成平台或供应商已经复核。

## 4. 页面与证据

- `/help`：新手路径、快捷键、术语、隐私/AI 说明入口、FAQ 搜索与空状态。
- `/legal`：用户协议、隐私政策、AI 生成内容说明入口；各文档有静态详情页和运行错误边界。
- `/workspace/[workId]/export`：展示内容安全状态、规则版本、证据、申诉表单、已提交说明、撤回动作和状态时间线。
- `help.spec.ts`、`legal.spec.ts` 与 `export-publish.spec.ts` 覆盖真实生产路由、作者语言、`prototype_only` 泄漏、无横向溢出和 390/900/1180/1440 四档视口。

## 5. 验证

- core tests：AI 标识确定性、四种导出格式正文标识、内容安全证据不含正文。
- contract/typecheck：新增 moderation schema、OpenAPI 与 Web 路由类型。
- HTTP + worker integration：导出重新生成保留同一 AI manifest；发布预览生成 clear/needs_review 记录；申诉提交、幂等 replay、撤回、clear 案件拒绝申诉和跨租户拒绝。
- RLS integration：新 moderation 表强制 RLS，租户审计 `uncovered=[]`。
- Playwright：help/legal 与 export-publish 的真实路由、作者语言、无横向溢出和语义流程已通过。作者已确认 `artifacts/ui/candidates/m3-131/` 的 12 张 Linux/Chromium 候选；正式 Golden 已写入 `artifacts/ui/golden/`，生成证据为 [Production CI #44045578715](https://github.com/ruifeng-y/novel-brain/actions/runs/44045578715)。

## 6. 边界

- 不提供最终法律意见，不声称未经审核的合规状态。
- 不连接第三方发布平台，不自动上传。
- 不使用用户内容训练模型。
- 申诉入口记录作者纠正与复核请求；V1 不新增后台管理员裁决界面，最终运营处理流程需随正式运营配置。
