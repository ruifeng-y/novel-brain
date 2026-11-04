# V1 Capability Traceability v2

> 状态：V1 delivery baseline，2026-11-04。基于 manifest 中的 117 个原始能力，新增 PERF-001 与 CONT-001 两项跨切面发布门禁，现共 **119 个唯一能力 ID**。
> 本表只表示能力有唯一 primary issue；不代表该 issue 已可启动、已实现或已验证。
> main implementation is not started; issue #84–#104 are packages where noted. Use child issues for /implement.

## 状态定义

- `mapped`：存在唯一主责 issue，且有设计来源与验收证据；不表示可立即实施。
- `ready`：阻塞依赖全部关闭/集成，接口与 schema 所有权明确，并已由维护者标记为可启动。
- `in_progress`：正在实施。
- `implemented`：代码存在，但尚未完成独立验证。
- `verified`：API/DB/Worker/UI/E2E/评测等适用证据齐全，并经 review。
- `released`：通过 V1 发布门禁。
- `deferred`：明确推迟到 V1 之后；不属于 V1 发布承诺。

## 唯一主责台账

**Primary issue** 是唯一主责，不代表唯一实现触点。**Supporting** 仅指基础能力、集成或依赖，不构成第二个主责。页面专项实现证据仍由对应 UI feature issue 提交；#104 只负责全局闭环。

| ID | Capability | Scope | Status | Primary issue | Supporting baseline / integration | Design source | API / DB / Worker / acceptance evidence | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACCT-001 | 邮箱验证码注册/登录 | V1 | mapped | #68 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Auth/Users; API + E2E 注册登录 | M0 |
| ACCT-002 | 密码重置/账号恢复 | V1 | mapped | #141 | #68 | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Auth; 邮件链接 + 恢复 E2E | M1 |
| ACCT-003 | 会话列表/退出所有设备 | V1 | mapped | #141 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Auth/Sessions; 会话撤销 E2E | M1 |
| ACCT-004 | 显示资料/多笔名 | V1 | mapped | #141 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Users/PenNames; API + UI | M1 |
| ACCT-005 | 账号完整导出 | V1 | mapped | #134 | #141 | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Users/Export; 下载包内容校验 | M3 |
| ACCT-006 | 注销/30 天恢复/永久删除 | V1 | mapped | #134 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Users/Purge; 生命周期 E2E | M3 |
| ACCT-007 | BYOK 模型配置/用途路由 | V1 | mapped | #69 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | ModelConfigs; 加密/掩码/用途 | M0 |
| ACCT-008 | 模型连接测试/错误状态 | V1 | mapped | #69 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | ModelConfigs; 成功/失败/限流 | M0 |
| ACCT-009 | 限流/安全状态/无管理员越权 | V1 | mapped | #68 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | Auth/Security; 安全 E2E | M0 |
| WORK-001 | 从想法/空白/模板/部分或完整设定创建作品 | V1 | mapped | #70 | #71, #72, #84 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works/StoryBible; 五种入口 E2E | M0 |
| WORK-002 | 默认文本导入：解析/切分/标题/保留原文 | V1 | mapped | #72 | #72 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Import; 大文件 + 断点 | M0 |
| WORK-003 | 可选设定提取：候选/冲突/报告/确认 | V1 | mapped | #71 | #71, #127 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Import/Canon; 候选确认 E2E | M0 |
| WORK-004 | 作品列表/搜索/筛选/排序 | V1 | mapped | #70 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works/Search; 长列表 + 搜索 | M0 |
| WORK-005 | 作品总览/进度/最近修改 | V1 | mapped | #70 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works/Jobs; 聚合数据 | M0 |
| WORK-006 | 归档/恢复/回收站/删除 | V1 | mapped | #142 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works; 生命周期 E2E | M1 |
| WORK-007 | 复制作品，默认不复制正文和版本 | V1 | mapped | #142 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works; 默认值校验 | M1 |
| WORK-008 | 作品设置/封面/标签/连载状态 | V1 | mapped | #142 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works/Storage; API + UI | M1 |
| WORK-009 | 全站当前作品 + 当前平行版本上下文 | V1 | mapped | #70 | #95, #123 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | Works/Branches; 切换一致性 E2E | M0 |
| ONBOARD-001 | 故事罗盘/故事蓝图 | V1 | mapped | #143 | #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | StoryBible/Planner; 生成 + 确认 | M0 |
| ONBOARD-002 | 九卡故事圣经/版本/锁定 | V1 | mapped | #143 | #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | StoryBible; 版本 + 锁定 | M0 |
| ONBOARD-003 | 题材包：仙侠/历史/都市 | V1 | mapped | #92 | #70, #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | GenrePacks; 三题材差异测试 | M2 |
| ONBOARD-004 | 世界铁律/硬规则 | V1 | mapped | #143 | #74, #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | Canon/StoryBible; 规则校验 | M0 |
| ONBOARD-005 | 核心人物/关系/人物弧 | V1 | mapped | #106 | #73, #74 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | Characters/Relations; 关系图 | M1 |
| ONBOARD-006 | 主线/支线/伏笔计划 | V1 | mapped | #146 | — | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | StoryLedger; 计划 + 账本 | M1 |
| ONBOARD-007 | 全书/卷/幕/章/场景大纲 | V1 | mapped | #145 | #75 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | Outline; 五层树 | M1 |
| ONBOARD-008 | 设定冻结/开书门禁 | V1 | mapped | #148 | — | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | StoryBible/Readiness; 门禁 E2E | M1 |
| SET-001 | 7 个设定顶层栏目 | V1 | mapped | #144 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | Settings; 信息架构 | M1 |
| SET-002 | 实体/别名/自定义字段 | V1 | mapped | #144 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | Entities/CustomFields; CRUD + 迁移 | M1 |
| SET-003 | 实体关系/有效期 | V1 | mapped | #106 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Relations; 关系图 | M1 |
| SET-004 | 势力/控制区/关系 | V1 | mapped | #107 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Factions/Relations; 控制区冲突 | M1 |
| SET-005 | 地图节点/连接/旅行时间/标记 | V1 | mapped | #107 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Maps; 地图 E2E | M1 |
| SET-006 | 力量体系/境界/突破/代价 | V1 | mapped | #108 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | PowerSystem; 战力校验 | M1 |
| SET-007 | 金手指/规则/代价/成长 | V1 | mapped | #108 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | GoldenFinger; 规则校验 | M1 |
| SET-008 | 物品功法/归属/流转 | V1 | mapped | #108 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Items/Ownership; 归属校验 | M1 |
| SET-009 | 时间线/纪元/事件/行程 | V1 | mapped | #107 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Timeline; 时间冲突 | M1 |
| SET-010 | 人物档案/状态/认知/声线 | V1 | mapped | #106 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | Characters/Knowledge; 知识边界 | M1 |
| SET-011 | 设定状态：草稿/提案/锁定/废弃 | V1 | mapped | #144 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Settings/Canon; 状态机 | M1 |
| SET-012 | 设定提案/冲突证据/引用 | V1 | mapped | #144 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | Canon/Critics; 提案 E2E | M1 |
| PLAN-001 | 大纲树/看板/张力曲线 | V1 | mapped | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | Outline; 五层视图 | M1 |
| PLAN-002 | 大纲重排/锁定/版本 | V1 | mapped | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | Outline; 版本 + 锁定 | M1 |
| PLAN-003 | 黄金三章/开篇策略 | V1 | mapped | #147 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | Outline/GoldenThree; 候选 + 门禁 | M1 |
| PLAN-004 | 伏笔账本/剧情线/人物弧 | V1 | mapped | #146 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | StoryLedger; CRUD + 检查 | M1 |
| PLAN-005 | 生成准备度检查 | V1 | mapped | #148 | #75 | M1 Spec #80; PlanningModule contract; ADR 0019 | Readiness; 缺项提示 | M1 |
| PLAN-006 | 卷/幕契约与重规划触发 | V1 | mapped | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | Planner; 偏离报告 | M1 |
| PLAN-007 | 场景卡/节拍/信息释放 | V1 | mapped | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | Outline/Scene; 场景生成 | M1 |
| AGENT-001 | Agent 角色/I/O 契约 | V1 | mapped | #109 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Agents; Schema + 契约测试 | M1 |
| AGENT-002 | 确定性编排器状态机 | V1 | mapped | #110 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Orchestrator; 状态机 E2E | M1 |
| AGENT-003 | 工具白名单/读写权限 | V1 | mapped | #109 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Agents/Tools; 越权测试 | M1 |
| AGENT-004 | P0–P4 ContextPack 编译 | V1 | mapped | #111 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | ContextCompiler; 来源/淘汰 | M1 |
| AGENT-005 | 关键事实固定/自适应预算 | V1 | mapped | #111 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | ContextCompiler; P0 不丢失 | M1 |
| AGENT-006 | 结构化检索/实体图/别名扩展 | V1 | mapped | #112 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Search/Context; 召回测试 | M1 |
| AGENT-007 | 向量检索增强 | 后续 | deferred | — | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Search/Vector; Phase 2 | Post-V1 |
| AGENT-008 | 分层摘要/失效重算 | V1 | mapped | #113 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Summaries/Index; 重建 E2E | M1 |
| AGENT-009 | Prompt/模型版本/参数记录 | V1 | mapped | #114 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Agents/ModelCalls; 轨迹可回放 | M1 |
| AGENT-010 | 生成轨迹/成本/失败升级 | V1 | mapped | #114 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Trace/Eval; 轨迹查询 | M1 |
| AGENT-011 | 幂等/重试/检查点/人工恢复 | V1 | mapped | #115 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Jobs/Agents; 断点恢复 E2E | M1 |
| GEN-001 | 单章生成 | V1 | mapped | #76 | #75 | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Generation; 生成 E2E | M0 |
| GEN-002 | 续写/改写/扩写/缩写/改视角/钩子/标题/摘要 | V1 | mapped | #116 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Generation; 每种动作 E2E | M1 |
| GEN-003 | 事实抽取/提案/来源句 | V1 | mapped | #77 | #77 | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Facts/Proposals; 来源可追溯 | M0 |
| GEN-004 | 连续性/文风/读者 Critic | V1 | mapped | #117 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Critics; 结构化问题 | M1 |
| GEN-005 | 两轮定向修订 | V1 | mapped | #118 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Reviser; 修订差异 | M1 |
| GEN-006 | 正史提交/Canon Curator | V1 | mapped | #78 | #78 | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Canon; 门禁 E2E | M0 |
| GEN-007 | 按章/卷/区间/全本批量 | V1 | mapped | #91 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | BatchJobs; 任务 E2E | M2 |
| GEN-008 | 父子任务/暂停/恢复/取消/重试 | V1 | mapped | #91 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Jobs; 重启恢复 | M2 |
| GEN-009 | 黄金三章候选/确认/锁定 | V1 | mapped | #147 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | GoldenThree; 候选对比 | M1 |
| GEN-010 | 卷级验收/自动通过/审核队列 | V1 | mapped | #149 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Review/Jobs; 高风险门禁 | M2 |
| GEN-011 | 成本/吞吐/失败报告 | V1 | mapped | #150 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | Usage/Reports; 单章/单卷 | M2 |
| QUALITY-001 | 六维质量报告 | V1 | mapped | #117 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Quality; 六维证据 | M1 |
| QUALITY-002 | 冲突证据/批注/忽略原因 | V1 | mapped | #117 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Critics/Annotations; 问题生命周期 | M1 |
| QUALITY-003 | 事实确认/驳回/修改 | V1 | mapped | #77 | #78 | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Facts/Proposals; 逐条确认 | M0 |
| QUALITY-004 | 审核队列/批准/驳回/批量 | V1 | mapped | #149 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Review; 批量低风险 | M2 |
| QUALITY-005 | 黄金三章/卷末验收 | V1 | mapped | #90 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Gates; 作者签收 | M1 |
| QUALITY-006 | 固定基准集/回归门禁 | V1 | mapped | #139 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Eval; 三题材 + 长线 | M3 |
| QUALITY-007 | 作者反馈记录 | V1 | mapped | #118 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Feedback; 接受/拒绝/改写 | M1 |
| QUALITY-008 | 人物声线/风格漂移检查 | V1 | mapped | #119 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | Style/Characters; 卷级检查 | M1 |
| QUALITY-009 | 真实读者反馈 | 后续 | deferred | — | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | ReaderFeedback; 后续 | Post-V1 |
| CHANGE-001 | 修改请求/原因/差异/来源 | V1 | mapped | #120 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Changes; 请求 E2E | M2 |
| CHANGE-002 | 影响分析/六项检查 | V1 | mapped | #121 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Changes; 冲突分类 | M2 |
| CHANGE-003 | 应用/撤销修改 | V1 | mapped | #122 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Changes/Canon; 应用 E2E | M2 |
| CHANGE-004 | 任意版本点拉平行版本 | V1 | mapped | #123 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Branches; 独立正史 | M2 |
| CHANGE-005 | 正文/事实/设定/大纲/伏笔比较 | V1 | mapped | #124 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Branches; 逐对象差异 | M2 |
| CHANGE-006 | 逐对象摘取/合并 | V1 | mapped | #124 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Branches/Canon; 冲突确认 | M2 |
| CHANGE-007 | 高风险合并门禁 | V1 | mapped | #125 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Gates; 不可绕过 | M2 |
| CHANGE-008 | 回滚新版本/审计 | V1 | mapped | #125 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Versions/Audit; 历史保留 | M2 |
| CHANGE-009 | 全局当前分支/分支切换 | V1 | mapped | #123 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | Branches; 数据一致 | M2 |
| IO-001 | TXT/Markdown/DOCX 解析/切分/合并/拆分 | V1 | mapped | #126 | #72 | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Import; 文件矩阵 | M2 |
| IO-002 | 可选设定提取/候选/冲突/报告 | V1 | mapped | #127 | #71 | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Import/Canon; 报告 E2E | M2 |
| IO-003 | 导入后台任务/断点/进度 | V1 | mapped | #126 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Jobs/Import; 千万字夹具 | M2 |
| IO-004 | 导出格式/范围/历史/下载/过期 | V1 | mapped | #129 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Exports/Storage; 全格式 E2E | M3 |
| IO-005 | 发布检查/预览/文案/标签 | V1 | mapped | #130 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Publish; 检查 + 预览 | M3 |
| IO-006 | 账号完整导出 | V1 | mapped | #134 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Users/Export; 包内容校验 | M3 |
| IO-007 | 备份/恢复/孤儿清理 | V1 | mapped | #136 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | Ops/Storage; 恢复演练 | M3 |
| SEARCH-001 | 跨作品/作品内全局搜索 | V1 | mapped | #128 | — | Backend design §1.2 and ContextModule; ADR 0018, 0019 | Search; 中文检索 | M2 |
| SEARCH-002 | 全文索引/更新/重建 | V1 | mapped | #128 | — | Backend design §1.2 and ContextModule; ADR 0018, 0019 | Search/Index; 提交后更新 | M2 |
| NOTIFY-001 | 站内通知/审核提醒/已读 | V1 | mapped | #97 | — | M2 Spec #81; NotificationModule contract | Notifications; 任务通知 | M2 |
| SEC-001 | BYOK 加密/掩码/白名单/SSRF 防护 | V1 | mapped | #69 | #69 | ADR 0023; M0 Protocol Freeze §§3, 8 | Security/ModelConfigs; 安全 E2E | M0 |
| SEC-002 | RLS/租户隔离 | V1 | mapped | #132 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | Database/RLS; 跨用户测试 | M3 |
| SEC-003 | 日志脱敏/追踪默认关闭 | V1 | mapped | #133 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | Observability; 日志检查 | M3 |
| SEC-004 | 删除/备份过期/孤儿数据清理 | V1 | mapped | #134 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | Jobs/Storage; 删除 SLA | M3 |
| SEC-005 | 内容安全/AI 标识/申诉 | V1 | mapped | #131 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | Moderation; 内容治理 | M3 |
| SEC-006 | 限流/审计/无管理员越权 | V1 | mapped | #132 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | Security/Audit; 安全回归 | M3 |
| UI-001 | 页面/动作/API/状态矩阵 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 矩阵完整 | M0–M3 |
| UI-002 | 设计令牌/组件清单 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 组件对照 | M0–M3 |
| UI-003 | 7 栏/3 题材/统一状态枚举 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 信息架构 | M0–M3 |
| UI-004 | 逐页 loading/empty/error/disabled/permission/partial/long | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 状态矩阵 | M0–M3 |
| UI-005 | 1440/1180/900/390 响应式 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; Playwright 截图 | M0–M3 |
| UI-006 | Playwright 结构/截图基线 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; CI 门禁 | M0–M3 |
| UI-007 | Agent UX：本章参考/来源/冲突/修订/成本/失败/确认 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 页面验收 | M0–M3 |
| UI-008 | 导入报告/黄金三章/分支比较页面 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 页面验收 | M0–M3 |
| UI-009 | 作者语言/无内部术语/prototype_only 登记 | V1 | mapped | #104 | #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | —; 术语扫描 | M0–M3 |
| OPS-001 | 健康检查/局域网与云部署 | V1 | mapped | #135 | #67 | Backend design §§11–13; ADR 0023 | Ops/Deploy; 部署 smoke | M3 |
| OPS-002 | 备份/恢复演练 | V1 | mapped | #136 | — | Backend design §§11–13; ADR 0023 | Ops/Backup; RPO/RTO | M3 |
| OPS-003 | 监控/日志/成本告警 | V1 | mapped | #135 | — | Backend design §§11–13; ADR 0023 | Observability; 告警演练 | M3 |
| EVAL-001 | 三题材 + 长线基准集 | V1 | mapped | #139 | #79 | M3 Spec #82; EvalModule; ADR 0022 | Eval; 固定数据集 | M3 |
| EVAL-002 | 评分 rubric/阈值/回归 | V1 | mapped | #139 | — | M3 Spec #82; EvalModule; ADR 0022 | Eval; 发布门禁 | M3 |
| EVAL-003 | 真实 DeepSeek smoke | V1 | mapped | #140 | #79 | M3 Spec #82; EvalModule; ADR 0022 | Eval/AI; 连接与质量 | M3 |
| EVAL-004 | Prompt/模型灰度与回滚 | V1 | mapped | #140 | — | M3 Spec #82; EvalModule; ADR 0022 | Eval/Agents; 版本治理 | M3 |
| PERF-001 | 1000 万字容量/性能/恢复基准 | V1 | mapped | #137 | #91/#93/#95/#96/#128/#135/#136 | Backend design §§12–13; #137 | 确定性 10M fixture；p50/p95/p99、吞吐/错误/资源/存储/成本；容量与恢复压测 | M3 |
| CONT-001 | 3000–4000 章跨卷叙事连续性基准 | V1 | mapped | #138 | #106–#119/#86/#90/#115 | ADR 0017/0019/0022; #138 | 跨卷 ground truth；角色知识边界/状态/时间/伏笔/分支；自动检测 + 分层人工盲评 | M3 |

## 强制规则

1. Manifest 与本表按 ID 一一对应；每个 V1 ID 恰有一个 Primary issue。无主责只能是明确的 `deferred`，并记录理由和后续边界。
2. Primary issue 必须是具体实现任务或明确的 cross-cutting release gate；package/epic parent 不能被误标为单次实现 ticket。
3. 任一 issue 的 Capability IDs 必须与本表主责归属一致；跨任务引用写在 Supporting 或 Dependencies，不重复取得主责。
4. 每个 leaf issue 必须链接设计来源、受影响 API/DB/Worker/UI 面、可执行测试类型和可复现验收证据。
5. `mapped` 不等于 `ready`。依赖全部满足后才允许 /implement；不得仅凭 issue 存在或标签开始。
6. `implemented` 不等于 `verified`；发布前必须提供机器测试结果、人工签收或基准报告。
7. AGENT-007（向量检索增强）与 QUALITY-009（真实读者反馈）保持 post-V1/deferred，不得用假接口计入 V1。
8. PERF-001 与 CONT-001 是独立的 V1 发布门禁：前者验证系统容量，后者验证长篇叙事连续性，彼此不可替代。