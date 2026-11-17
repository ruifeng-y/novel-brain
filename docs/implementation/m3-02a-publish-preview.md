# M3-02a 发布检查、目录元数据与读者预览

> Issue: #130
> Capability: IO-005
> Status: implemented; production visual candidate pending author sign-off

## 1. 实现范围

- 新增确定性发布检查 `publish-check-v1`，输出稳定检查码、作者文案、规则版本和证据。
- 发布检查覆盖书名、作者、简介、题材、标签、封面元数据、前三章、黄金三章钩子、章节字数、内容安全复核、AI 生成内容标识、版权提醒和导出格式。
- `blocked` 会令 `publishReady=false`；`warning` 仍可发布但保持独立可见，不会被合并成单一通过状态。
- 平台预设固定为通用网文、起点和番茄。预设只改变标题格式、标签上限、字数建议和发布文案展示，不执行第三方上传。
- 发布预览固定所属用户、作品、创作线、导出 receipt、源版本和 manifest hash，并保存目录、前 3 章读者预览、发布文案与完整检查证据。
- 当前版本预览在创作线版本变化后返回 `stale=true`；指定历史版本的预览不会因当前版本头变化而错误失效。
- 生产页面 `/workspace/[workId]/export` 提供真实导出、后台进度轮询、下载、重新导出、发布检查、元数据编辑、发布文案和读者预览。

## 2. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/works/:workId/branches/:branchId/publish-check` | 基于 completed 且未过期的导出创建固定发布预览 |
| GET | `/api/v1/works/:workId/branches/:branchId/publish-check` | 最近 20 份发布预览，计算当前版本是否 stale |
| GET | `/api/v1/works/:workId/branches/:branchId/publish-check/:previewId` | 读取指定固定预览 |

请求必须引用当前用户、当前作品和当前创作线的 completed export receipt。未完成导出返回 `PUBLISH_EXPORT_NOT_READY`，过期返回 `PUBLISH_EXPORT_EXPIRED`，跨租户返回 `FORBIDDEN_TENANT_ACCESS`。

## 3. 数据与安全

- 新增 `publish_previews`，保存 `user_id/work_id/branch_id/export_id`、源和请求版本、manifest hash、平台展示、元数据、检查、目录、读者预览和发布文案。
- 表启用并强制 tenant RLS；所有 repository 查询显式带 `user_id/work_id/branch_id`，并在事务内设置 `SET LOCAL app.user_id`。
- 创建前重新读取导出 source descriptor，逐章校验 chapter version、version node、内容 hash 和 manifest；源内容无法复现时 fail closed。
- 发布预览只读取导出的固定章节版本，不读取创作线当前正文替代历史内容。
- 内容安全使用作者复核提示，不按关键词自动封禁，符合 ADR 0023。

## 4. 页面状态与证据

- 页面覆盖 loading、empty、error、partial、expired、long。
- 所有主操作连接真实 API：导出任务、recent receipt、download、re-run publish check、metadata update、reader preview 和 copy。
- 四档 Playwright 视口为 390 / 900 / 1180 / 1440，检查真实导出、发布检查、读者预览、复制、元数据编辑、过期恢复和无横向溢出。
- 候选 Golden：`artifacts/ui/golden/export-publish/export-publish-{390,900,1180,1440}.png`。在作者明确签收前，parity-matrix 状态保持 `production-built`。

## 5. 验证

- contracts/core tests：平台枚举、响应结构、blocking 与 warning 分离、预设只改展示。
- HTTP + worker integration：completed export 创建预览、blocked/warning、三档预设、stale、重新导出后 regenerate、跨 tenant 和 expired export。
- API/Web typecheck、Web lint、OpenAPI generation 和 export-publish Playwright 通过。
- tenant RLS audit 将 `publish_previews` 纳入强制策略清单，`uncovered=[]`。

## 6. 边界

- 不调用起点、番茄或任何第三方发布 API，不绑定平台账号。
- 申诉流程、帮助与法律页面属于 #131。
- 作者签收前不把页面提升为 `parity-verified`，也不复制原型图作为生产 Golden。
