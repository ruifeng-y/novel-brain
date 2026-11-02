# NovelBrain V1 发布说明（局域网/内部 RC）

> 版本：V1.0.0-rc.3（内部发布候选）
> 日期：2026-11-03
> 代码基线：`8f376a5`
> 分支：`codex/ticket-33-v1-acceptance`
> 结论：**局域网/内部 RC GO；正式公开发布 NO-GO**

## 摘要

本候选版本关闭了全部 V1 工程发布 blocker：

- B-01 账户生命周期与多笔名。
- B-02/B-03 账号级审计与完整数据导出。
- B-04 作品导入/归档/回收站/复制/完本只读/书架指标。
- B-07 生产 TLS/HSTS、签名下载、脱敏日志、生产 SMTP、异地备份和部署检查。
- B-12 工作级资料/设置、封面上传、一句话/空白创建。
- B-13 独立大纲 Markdown/JSON 和历史版本 ZIP/manifest 导出。

自动化功能、数据库集成、构建、浏览器、性能、安全和恢复演练通过。此版本可作为
局域网/内部 beta 发布候选。

正式公开发布仍被四个外部人类/真实环境门槛阻断：B-05 人工质量盲评、B-06 真实
DeepSeek、B-08 法务/运营、B-07 live cloud 证据。没有已知代码 P1；P2 残余风险见
`docs/release/v1-known-limitations.md`。

## 本候选包含

### 账户与安全

- 邮箱验证码注册、登录、找回密码、重置密码、修改密码、修改邮箱。
- 显示资料、头像链接、简介、多笔名和作品署名。
- 注销申请、30 天恢复、永久删除、删除回执和后台清理。
- 登录、退出、Key、导出、删除、生成和事实决策的账号级审计。
- 完整账号 ZIP 导出、短时签名下载、7 天保留和作者隔离。

### 创作闭环

- 仙侠、历史、都市三题材作品和题材包。
- 一句话想法、空白作品、题材模板和 TXT/Markdown/DOCX 导入。
- 工作级目标读者、章节字数、更新节奏、风格样本、禁忌、简介、标签和封面。
- 故事圣经、设定中心、人物档案/状态、地图/势力、力量体系、物品功法、时间线。
- 五层大纲、剧情线、伏笔、人物弧账本和准备度。
- 三栏写作台、流式生成、续写/重写/扩写/缩写/改视角/钩子/标题/摘要。
- 事实确认、连续性检查、六项质量报告、批注和版本历史。

### 批量、修改与版本

- 按章、按卷、自定义区间、全本批量任务和审核队列。
- 暂停、恢复、取消、失败重试、任务报告和并发门限。
- 修改请求、影响分析、六步一致性检查、平行版本、选择性摘取和版本图回滚。
- 历史版本 ZIP 导出，含版本清单和逐文件 SHA-256 manifest。

### 导出、发布与作品生命周期

- TXT、Markdown、DOCX、EPUB；通用网文、起点、番茄预设。
- 预览、后台导出、7 天下载历史、短时签名链接。
- 独立大纲 Markdown/JSON 导出。
- 发布建议、读者预览、六项发布检查、复制/下载。
- 作品归档、回收站、30 天恢复、复制作品、完本只读、书架指标和永久清理。

### 生产部署

- `docker-compose.production.yml`、`infra/caddy/Caddyfile.production` 和生产 env 示例。
- TLS/HSTS、HTTP→HTTPS、Secure Cookie 和生产启动检查。
- 生产 SMTP TLS/证书配置、JSON 日志和 30 天轮转配置。
- `pnpm deploy:check`、`pnpm deploy:verify`、`pnpm deploy:smoke`。
- offsite 备份复制、SHA-256 清单和恢复核对。

## 验证摘要

| 项目 | 结果 |
| --- | --- |
| lint | 通过 |
| typecheck | 13/13 tasks |
| Vitest | 57 files / 269 tests |
| build | 8/8 tasks |
| Compose | 8/8 services，52 migrations |
| Playwright | 39/39，Chromium + 390px 移动视口 |
| M3 demo gate | 12/12 |
| 安全/部署专项 | 12 files / 43 tests |
| 部署配置 | `deploy:check` artifacts/Compose/Caddy PASS |
| 依赖审计 | 0 high / 0 critical / 3 moderate |
| 3M 字基准 | 打开 p95 16.7ms，搜索 p95 156.3ms，SSE p95 100ms，并发 4/2/2 |
| 恢复演练 | 数据库 3 秒，13/13 对象逐字节校验，RPO 2 秒 |

完整矩阵和证据见 `docs/acceptance/m3/acceptance.md`。

## 升级与迁移

- 本候选在空 Postgres 16 schema 执行 `0000` 到 `0051` 共 52 条迁移。
- `0050` 增加工作级创建参数；`0051` 增加大纲/历史版本导出所需结构和索引。
- 生产迁移前必须备份并核对迁移计数。
- 账号和作品永久清理任务需要 `DATABASE_ADMIN_URL`，生产先 dry-run。
- 回滚以备份恢复为主；项目没有 down migration。
- 完整步骤见 `docs/release/v1-migration-rollback-runbook.md`。

## 公开发布前仍需关闭

### 外部人类门槛

1. B-05 目标读者 10 人盲评、人工质量量表和文本质量。
2. B-06 真实 DeepSeek 质量、延迟、限流、费用、重试和结构化输出。
3. B-08 L-01 到 L-12 法务/运营确认。

### 真实部署证据

4. B-07 真实 DNS/ACME 证书签发/续期、云盘/KMS 静态加密、生产 SMTP 投递、
   集中日志平台和异地灾备切换。

### P2 残余

5. 历史版本导出同步生成，超大历史可能需要后台化；地图二进制不打包。
6. Edge/Safari 浏览器矩阵、集中监控、真实 30/1,000 章长跑校准。
7. 运维 CLI 的密码重置/账号禁用/注册开关便利命令。

## 发布决定

**LAN/internal RC: GO。**

**Public release: NO-GO。**

本次不创建正式 release tag，不推送远端，不关闭 #33。内部 beta 可以开始；公开
发布必须等待外部质量和真实部署证据关闭后重新执行完整门禁。
