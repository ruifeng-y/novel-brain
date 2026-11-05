# M0-06 旧稿导入与章节切分

> Issue: #72
> Capability IDs: WORK-002, IO-001
> UI parity matrix: new-project

## 实现范围

- 支持小型 UTF-8 TXT 和 Markdown 旧稿文件，识别 Markdown 标题与中文“第 N 章”标题。
- 章节预览按原顺序返回标题、正文、字数和原文偏移结果；标题区与正文区分离，作者可以修改章节标题。
- 作者可以在确认前拆分章节、合并相邻章节；前后章节正文按顺序拼接后必须与原文完全一致。
- 默认文本导入只保留原文和章节结构，不创建设定候选、冲突、导入报告或已确认设定。
- 空文件返回可见空状态；无法识别章节标题时返回部分成功状态；不支持的文件类型和无法解析的 UTF-8 编码返回稳定的 `VALIDATION_INVALID` 错误。
- 确认导入在同一事务内创建作品、`main` 分支、初始快照节点、有序章节、章节版本和连续版本节点。
- 每个章节版本通过 `version_node_id` 引用单一版本图；分支头指向最后一个章节版本节点。
- 导入任务、章节和章节版本均按当前用户隔离；`chapters` 与 `chapter_versions` 启用 RLS。
- Web BFF 以原始字节转发 multipart 请求，避免 TXT/Markdown 文件在代理层被文本解码破坏。
- `/workspace/new-project` 的“导入旧稿”入口使用真实 API，覆盖空、部分成功、解析错误、不支持文件、禁用和四档响应式状态。

## 数据与契约

- `work_source_mode` 增加 `manuscript_import`；`import_jobs.mode` 增加 `manuscript_text`。
- 新增 `chapters`、`chapter_versions`，章节版本正文保存 `content` 和 SHA-256 `content_hash`。
- 共享 Zod 契约覆盖旧稿预览、章节行、确认请求、作品、章节和章节版本响应。
- OpenAPI 从 NestJS 控制器和共享 Zod schema 生成，并同步派生 TypeScript 类型。

## 验证接缝

- API：通过 `/api/v1/imports/manuscripts`、预览读取和确认路由，使用真实 PostgreSQL/Redis 集成测试验证。
- Web：通过 `/workspace/new-project` 的真实浏览器流程验证标题编辑、拆分、合并、确认和状态展示。
- 数据：HTTP 确认响应与数据库计数共同验证无候选、冲突、报告或已确认设定产生。

## 验证结果

- `pnpm check`：通过，28 个单元/契约测试。
- `pnpm test:integration`：通过，25 个真实 PostgreSQL/Redis HTTP 集成测试。
- `pnpm exec playwright test apps/web/e2e/parity/new-project.spec.ts`：通过，11 个 Playwright 测试。
- 旧稿 HTTP 集成测试覆盖 Markdown、TXT、空文件、部分成功、不支持文件、编码错误、标题编辑、拆分、合并、幂等重放、原文篡改拒绝和跨租户隔离。
- Playwright 覆盖编辑标题、拆分、合并、完成导入，以及 390/900/1180/1440 四档视口无横向溢出。

## 边界

- M0 只支持小型 TXT/Markdown 夹具；DOCX、大文件分块、断点续跑和完整导入任务由 #126 继续实现。
- 默认文本导入不执行设定提取；可选候选抽取和冲突报告由 #127 继续实现。
- 章节编辑工作台、章纲和完整版本操作由 #75 继续实现；本 ticket 只创建导入所需的有序章节版本。
- 生产 golden 截图和作者视觉签收按 ADR 0027 由 #79 完成。
