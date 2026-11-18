# M1-142 作品设置、归档恢复、复制与回收站

> Issue: #142
> Capabilities: WORK-006, WORK-007, WORK-008
> Status: implementation and visual sign-off complete; final normal PR CI required before merge

## 实现范围

- Work metadata 使用 `version` 乐观锁编辑标题、笔名、题材、规模、章节字数、连载状态、标签、简介、风格样本和禁忌。
- 归档与恢复使用独立端点，恢复回到归档前状态，并保留 branch、version node、正文和设定。
- 回收站使用 `deletedAt` 与 30 天 `purgeAfter`。默认列表隐藏回收站作品，`trash=true` 单独列出。
- 永久删除同时要求保留期结束和未过期已完成导出；作品删除通过外键级联清理分支、版本、正史、任务、搜索和导出记录，并删除导出与封面对象。
- Worker 每分钟扫描满足恢复期和导出门禁的回收站作品，执行定时永久删除。
- duplicate 默认只复制 metadata/settings、故事圣经、独立设定、大纲、账本和可独立风格样本。正文、章节、章节版本、章节派生事实和依赖章节的风格内容必须显式 opt-in 或重新生成。
- 封面上传接受 JPEG、PNG、WebP，限制 5MB，使用 `sharp` 旋转、缩放并重编码为 WebP；对象通过作者会话保护的 cover route 读取。

## 验证证据

- `apps/api/test/works.integration.test.ts` 覆盖乐观锁、归档/恢复、回收站恢复、30 天门禁、导出门禁、永久删除、封面上传、复制边界、跨租户拒绝和 PostgreSQL RLS。
- `apps/web/e2e/parity/work-settings.spec.ts` 覆盖真实保存、封面上传、归档/恢复、保守复制、移入回收站、恢复、错误/权限/加载/只读状态与四视口截图。
- `apps/web/e2e/parity/dashboard.spec.ts` 覆盖作品列表、筛选、长列表、错误状态、管理入口和四视口截图。

## 视觉状态

四视口生产 Golden 已生成到 `artifacts/ui/golden/work-settings/`。作者已确认四档生产布局；390px Linux/Chromium actual 来自 [Production CI #44124021122](https://github.com/ruifeng-y/novel-brain/actions/runs/44124021122)，其余 `work-settings` Golden 由 [Production CI #44138638764](https://github.com/ruifeng-y/novel-brain/actions/runs/44138638764) 的受控 `update_golden` 运行生成。该记录只证明视觉证据；当前 release status 以 `docs/ui/v1-ui-parity-matrix.md` 为准，`work-settings` 在逐动作持久化审计和最终正常 PR CI 通过前保持 `production-built`。
