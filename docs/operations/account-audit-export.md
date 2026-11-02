# 账号审计与完整数据导出

本文说明 V1 发布门槛 B-02 和 B-03 的实现边界、作者界面和运维检查点。

## 账号审计

账号审计按作者隔离，只能由作者本人查询和导出。记录写入后不可修改或删除。

覆盖的动作：

- 登录成功、登录失败、退出当前设备、退出所有设备
- 添加、更新、删除模型 API Key
- 发起作品导出、发起账号完整导出、完成、失败、下载
- 注销申请和取消注销（由账号生命周期流程调用）
- 发起单章或批量生成、暂停、恢复、取消、重试
- 批量审核批准、送写作台、驳回、忽略
- 确认或驳回事实提案

接口：

- `GET /api/v1/users/me/audit?q=&action=&limit=`：按内容、动作或中文动作标签搜索。
- `GET /api/v1/users/me/audit/export?q=&action=`：导出筛选结果为 UTF-8 BOM CSV。

审计元数据会递归屏蔽字段名中含 `apiKey`、`password`、`token`、`secret` 或
`credential` 的值。审计标题和详情不得写入正文、密码、会话令牌或模型 Key。

## 完整账号导出

作者在“隐私与合规”页面点击“导出全部数据”后，API 创建后台任务并返回任务 ID。
Worker 使用作者租户上下文读取数据、生成 ZIP 并写入作者前缀的对象存储。

接口：

- `POST /api/v1/users/me/export`：创建后台导出，限每作者每小时 3 次。
- `GET /api/v1/users/me/export`：列出最近导出。
- `GET /api/v1/users/me/export/:id`：读取进度、数据计数和下载链接。
- `GET /api/v1/users/me/export/:id/download?expires=&signature=`：校验作者会话、
  任务所有权、签名和有效期后下载。

导出保留 7 天。下载链接是绑定作者 ID、任务 ID 和到期时间的 HMAC 签名链接，
有效期为 10 分钟。任务过期、签名被篡改、其他作者访问返回错误，不发送文件。

## 压缩包内容

`manifest.json` 记录导出版本、作者 ID、生成时间、各区域数量，以及每个文件的大小和
SHA-256。其余文件：

- `account.json`：账号资料，不含密码摘要。
- `model-configs.json`：模型配置元数据，不含 API Key 或密文。
- `works.json`、`works/branches.json`：作品和分支。
- `settings.json`：故事圣经、故事圣经修订、主线账本、大纲、设定、字段、关系、
  力量体系、金手指、物品功法、物品归属和时间线。
- `characters.json`：人物档案、当前状态和状态历史。
- `maps.json`：地图节点、连接、图片元数据、标记和人物位置。
- `text.json`：章节、正文版本、分支提交和分支 ID 映射。
- `facts.json`：事实提案、已确认事实、正史提交和快照。
- `changes.json`：修改请求、影响报告和六项校验。
- `generation.json`：生成请求、上下文包、草稿、任务步骤、事件、报告、批注和质量报告。
- `audit.json`：作品审计和账号审计。
- `exports.json`：作品导出和账号导出任务元数据。
- `assets/maps/`：存在的地图图片原文件。

导出包不包含密码摘要、会话令牌、模型 Key、模型 Key 密文、注册验证码或系统内部任务。

## 运维检查点

- `worker` 必须运行并消费 `account-export` 队列。
- API 和 Worker 必须使用不同的 `novel_app` 数据库角色，确保 RLS 生效。
- MinIO 必须可写；导出文件放在 `<author-id>/account-exports/` 前缀下。
- 账号审计表保留策略建议 30 天；账号删除后按法律和隐私政策处理保留副本。
- 监控 `account_export_jobs` 的失败数量、Worker 队列积压和对象存储容量。
