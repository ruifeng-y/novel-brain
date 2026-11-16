# M3-01a 导出格式、范围选择与版本清单

> Issue: #129
> Capability: IO-004
> Status: implemented; export-publish UI and publish checks remain #130/#131

## 1. 实现范围

- 新增 `POST/GET /api/v1/works/:workId/branches/:branchId/exports`、单条 receipt 查询和下载接口。
- 支持 TXT、Markdown、DOCX、EPUB；所有文本统一 UTF-8，DOCX/EPUB 使用确定性 ZIP。
- 支持当前章、选中章节、连续章节区间、整卷、全本；`sourceVersionNodeId` 可选择指定历史版本。
- 平行版本通过请求所属 `branchId` 固定，不读取 main 或当前分支替代内容。
- 导出前固定精确章节、chapter version 和 version node，写入不可变 source descriptor。
- manifest 记录作品/分支、requested/resolved version node、范围、格式、选项、章节版本、内容 hash、补充资料 hash 和总字符数。
- 可选故事圣经、设定附录、大纲、伏笔账本和修改记录；API key、session、密码 hash 等 secret 字段不会进入查询。
- 大型导出统一进入 durable worker job；receipt 默认保留 7 天，过期清理 payload，manifest 和审计记录保留。

## 2. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/works/:workId/branches/:branchId/exports` | 幂等创建导出 receipt/job |
| GET | `/api/v1/works/:workId/branches/:branchId/exports` | 导出历史 |
| GET | `/api/v1/works/:workId/branches/:branchId/exports/:exportId` | receipt/manifest 状态 |
| GET | `/api/v1/works/:workId/branches/:branchId/exports/:exportId/download` | completed 文件下载 |

创建请求必须带 `Idempotency-Key`。未完成下载返回 `WORK_EXPORT_NOT_READY`；过期返回 `WORK_EXPORT_EXPIRED`；跨租户访问返回 `FORBIDDEN_TENANT_ACCESS`。

## 3. Manifest 与可复现性

- manifest 不含非确定性时间字段；`manifestHash` 是完整来源和选项的 canonical JSON hash。
- `chapters[]` 按章节编号排序，并固定 `chapterVersionId`、`versionNodeId`、内容 SHA-256 和字符数。
- `branch.requestedVersionNodeId` 与 `branch.resolvedVersionNodeId` 分开记录，历史请求不会伪装成当前 head。
- DOCX/EPUB 内嵌 `version-manifest.json`，TXT/Markdown 在文末附版本清单。
- DOCX/EPUB 的 ZIP 时间戳固定，同一来源和请求会生成相同 bytes 与 checksum。

## 4. 数据与安全

- 新增 `work_export_receipts`，带 tenant RLS、role cleanup policy、7 天过期索引和 worker 状态。
- `jobs.type = export_work`，显式携带 `workId/branchId/actorId/idempotencyKey/exportId` 和版本化 checkpoint。
- worker 只读取 source descriptor 中固定的 chapter version IDs；内容 hash 不一致时 fail closed。
- 创建和完成导出均写 `audit_logs`；下载只允许当前 user/work/branch 范围内的 receipt。

## 5. 验证

- contract tests：4 种格式、5 种范围、重复 chapter ID 和反向 range。
- core tests：manifest/hash 稳定性、章节顺序、Unicode、XML 转义、DOCX/EPUB ZIP、内部 manifest 和 120 万字符输入。
- HTTP + worker integration：历史版本、平行版本、volume 范围、TXT/Markdown/DOCX 下载、幂等 replay、导出历史、7 天过期和跨 tenant 拒绝。
- secret canary 写入 model config 后不出现在 TXT/DOCX 导出。
- `pnpm typecheck` 覆盖 API/Worker；`pnpm test:integration` 在最终 PR 门禁中执行全量。

## 6. 边界

- `export-publish` 页面、预览和发布检查属于 #130/#131；本 ticket 不新增 UI 或发布平台上传。
- 当前 artifact payload 存储在 Postgres receipt 中；大规模对象存储迁移随容量 ticket #137 的生产级存储验证继续评估。
- EPUB 采用最小 EPUB 3 结构，不包含平台专属排版或封面设计。
