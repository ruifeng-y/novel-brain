# M0-04 作品创建、作品库与总览

> Issue: #70
> Capability IDs: WORK-001, WORK-004, WORK-005, WORK-009, ONBOARD-003
> UI parity matrix: dashboard, new-project, work-overview

## 实现范围

- 支持一句话想法、空白作品和仙侠模板三种 M0 创建入口。
- 每个作品在同一事务内创建 `main` 分支、初始 `snapshot` 版本节点和审计记录。
- 版本节点带 snapshot 引用、父节点外键和 node-type 约束；分支头指向唯一版本节点。
- 仙侠模板来自独立 `genre_packs` 表，不写入 `works.settings` 通用 JSONB。
- `works`、`work_branches`、`version_nodes` 启用 RLS，并通过事务级 `app.user_id` 上下文访问。
- 作品状态、题材、规模、来源、分支状态和版本节点类型均有数据库检查约束。
- 作品创建支持 24 小时幂等键；重复请求返回同一作品和主分支。
- 作品库支持搜索书名/笔名、状态筛选、题材筛选和 UUID v7 游标分页。
- 工作台使用游标继续加载长列表，不丢弃 `meta.nextCursor`。
- 作品总览返回标题、状态、笔名、题材、规模、章节字数目标、主分支、版本头和准备度摘要。
- `/workspace`、`/workspace/new-project`、`/workspace/[workId]/overview` 使用真实 API。
- 三页覆盖 loading、empty、error、disabled、partial、archived/readonly 和 long-content 状态。

## 验证结果

- `pnpm check`：26 个单元/契约测试通过。
- `pnpm test:integration`：13 个真实 PostgreSQL/Redis HTTP 集成测试通过。
- `pnpm test:e2e`：30 个真实 API Playwright 测试通过。
- 作品 HTTP 集成测试覆盖 idea/blank/template、幂等、列表搜索筛选分页、总览、主分支与跨租户隔离。
- Playwright 覆盖三种创建入口、作品库搜索筛选与继续加载、总览、状态页和 390/900/1180/1440 四档视口。
- 作品创建事务保证作品、main 分支、初始版本 head 和审计记录一起提交。
- 空白作品不写入故事事实；仙侠模板只写入题材包定义的模板字段。

## 边界

- 作品归档、恢复、永久删除由 #142/#134 继续实现；当前列表中的管理入口保持禁用。
- 故事圣经、大纲和写作台由后续 ticket 实现；总览只展示对应准备度。
- 导入设定/旧稿和冲突裁决属于 #71/#72，不在本 ticket 伪造冲突状态。
- 生产 golden 截图和作者签收按 ADR 0027 由 #79 完成。
