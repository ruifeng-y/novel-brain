# V1 Capability Traceability v2

> 状态：V1 delivery ledger，2026-11-26。共 **119 个唯一能力 ID**；116 个 V1 能力中 113 个已有可执行证据并标为 `verified`，3 个保留有界缺口。107 个非 UI V1 能力中 104 个已验证；UI-001..UI-009 已由 #238 的机器账本、Playwright 证据和 Production CI 收口。PERF-001 已按产品决定延期。CONT-001 的人工原始评分已由 #239 记录为 `complete-with-warnings`；#273 已生成保留 204 个样本身份的非批准清洗提案和 24 项真人裁决请求，但真实裁决仍为 0/24，`hook_prose_score` 处置未完成。EVAL-002 的 variance threshold 已由 #240 批准为 `0.1`；最终 release-head CI 仍由 #242 收口。
> `verified` 表示实现、集成和自动化验收证据已齐；不等于 V1 release approved。发布阻塞项以 `implemented` 或 `deferred` 保留。

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
| ACCT-001 | 邮箱验证码注册/登录 | V1 | verified | #68 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-001` | M0 |
| ACCT-002 | 密码重置/账号恢复 | V1 | verified | #141 | #68 | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-002` | M1 |
| ACCT-003 | 会话列表/退出所有设备 | V1 | verified | #141 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-003` | M1 |
| ACCT-004 | 显示资料/多笔名 | V1 | verified | #141 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-004` | M1 |
| ACCT-005 | 账号完整导出 | V1 | verified | #134 | #141 | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-005` | M3 |
| ACCT-006 | 注销/30 天恢复/永久删除 | V1 | verified | #134 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-006` | M3 |
| ACCT-007 | BYOK 模型配置/用途路由 | V1 | verified | #69 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-007` | M0 |
| ACCT-008 | 模型连接测试/错误状态 | V1 | verified | #69 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-008` | M0 |
| ACCT-009 | 限流/安全状态/无管理员越权 | V1 | verified | #68 | — | M0 Spec #66; M0 Protocol Freeze; ADR 0023 where security/deletion applies | `docs/implementation/m3-236-non-ui-capability-evidence.json#ACCT-009` | M0 |
| WORK-001 | 从想法/空白/模板/部分或完整设定创建作品 | V1 | verified | #70 | #71, #72, #84 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-001` | M0 |
| WORK-002 | 默认文本导入：解析/切分/标题/保留原文 | V1 | verified | #72 | #72 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-002` | M0 |
| WORK-003 | 可选设定提取：候选/冲突/报告/确认 | V1 | verified | #71 | #71, #127 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-003` | M0 |
| WORK-004 | 作品列表/搜索/筛选/排序 | V1 | verified | #70 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-004` | M0 |
| WORK-005 | 作品总览/进度/最近修改 | V1 | verified | #70 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-005` | M0 |
| WORK-006 | 归档/恢复/回收站/删除 | V1 | verified | #142 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-006` | M1 |
| WORK-007 | 复制作品，默认不复制正文和版本 | V1 | verified | #142 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-007` | M1 |
| WORK-008 | 作品设置/封面/标签/连载状态 | V1 | verified | #142 | — | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-008` | M1 |
| WORK-009 | 全站当前作品 + 当前平行版本上下文 | V1 | verified | #70 | #95, #123 | M0 Spec #66; Works/Import contracts; ADR 0018 for import lifecycle | `docs/implementation/m3-236-non-ui-capability-evidence.json#WORK-009` | M0 |
| ONBOARD-001 | 故事罗盘/故事蓝图 | V1 | verified | #143 | #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-001` | M0 |
| ONBOARD-002 | 九卡故事圣经/版本/锁定 | V1 | verified | #143 | #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-002` | M0 |
| ONBOARD-003 | 题材包：仙侠/历史/都市 | V1 | verified | #92 | #70, #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-003` | M2 |
| ONBOARD-004 | 世界铁律/硬规则 | V1 | verified | #143 | #74, #84 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-004` | M0 |
| ONBOARD-005 | 核心人物/关系/人物弧 | V1 | verified | #106 | #73, #74 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-005` | M1 |
| ONBOARD-006 | 主线/支线/伏笔计划 | V1 | verified | #146 | — | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-006` | M1 |
| ONBOARD-007 | 全书/卷/幕/章/场景大纲 | V1 | verified | #145 | #75 | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-007` | M1 |
| ONBOARD-008 | 设定冻结/开书门禁 | V1 | verified | #148 | — | M1 Spec #80; StoryBible/Planning contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#ONBOARD-008` | M1 |
| SET-001 | 7 个设定顶层栏目 | V1 | verified | #144 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-001` | M1 |
| SET-002 | 实体/别名/自定义字段 | V1 | verified | #144 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-002` | M1 |
| SET-003 | 实体关系/有效期 | V1 | verified | #106 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-003` | M1 |
| SET-004 | 势力/控制区/关系 | V1 | verified | #107 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-004` | M1 |
| SET-005 | 地图节点/连接/旅行时间/标记 | V1 | verified | #107 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-005` | M1 |
| SET-006 | 力量体系/境界/突破/代价 | V1 | verified | #108 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-006` | M1 |
| SET-007 | 金手指/规则/代价/成长 | V1 | verified | #108 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-007` | M1 |
| SET-008 | 物品功法/归属/流转 | V1 | verified | #108 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-008` | M1 |
| SET-009 | 时间线/纪元/事件/行程 | V1 | verified | #107 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-009` | M1 |
| SET-010 | 人物档案/状态/认知/声线 | V1 | verified | #106 | #74 | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-010` | M1 |
| SET-011 | 设定状态：草稿/提案/锁定/废弃 | V1 | verified | #144 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-011` | M1 |
| SET-012 | 设定提案/冲突证据/引用 | V1 | verified | #144 | — | M1 Spec #80; Canon/domain contracts; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SET-012` | M1 |
| PLAN-001 | 大纲树/看板/张力曲线 | V1 | verified | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-001` | M1 |
| PLAN-002 | 大纲重排/锁定/版本 | V1 | verified | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-002` | M1 |
| PLAN-003 | 黄金三章/开篇策略 | V1 | verified | #147 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-003` | M1 |
| PLAN-004 | 伏笔账本/剧情线/人物弧 | V1 | verified | #146 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-004` | M1 |
| PLAN-005 | 生成准备度检查 | V1 | verified | #148 | #75 | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-005` | M1 |
| PLAN-006 | 卷/幕契约与重规划触发 | V1 | verified | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-006` | M1 |
| PLAN-007 | 场景卡/节拍/信息释放 | V1 | verified | #145 | — | M1 Spec #80; PlanningModule contract; ADR 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#PLAN-007` | M1 |
| AGENT-001 | Agent 角色/I/O 契约 | V1 | verified | #109 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-001` | M1 |
| AGENT-002 | 确定性编排器状态机 | V1 | verified | #110 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-002` | M1 |
| AGENT-003 | 工具白名单/读写权限 | V1 | verified | #109 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-003` | M1 |
| AGENT-004 | P0–P4 ContextPack 编译 | V1 | verified | #111 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-004` | M1 |
| AGENT-005 | 关键事实固定/自适应预算 | V1 | verified | #111 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-005` | M1 |
| AGENT-006 | 结构化检索/实体图/别名扩展 | V1 | verified | #112 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-006` | M1 |
| AGENT-007 | 向量检索增强 | 后续 | deferred | — | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | Search/Vector; Phase 2 | Post-V1 |
| AGENT-008 | 分层摘要/失效重算 | V1 | verified | #113 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-008` | M1 |
| AGENT-009 | Prompt/模型版本/参数记录 | V1 | verified | #114 | — | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-009` | M1 |
| AGENT-010 | 生成轨迹/成本/失败升级 | V1 | verified | #114 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-010` | M1 |
| AGENT-011 | 幂等/重试/检查点/人工恢复 | V1 | verified | #115 | #76 | M1 Spec #80; AgentRuntime/ContextModule contract; ADR 0001, 0021 | `docs/implementation/m3-236-non-ui-capability-evidence.json#AGENT-011` | M1 |
| GEN-001 | 单章生成 | V1 | verified | #76 | #75 | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-001` | M0 |
| GEN-002 | 续写/改写/扩写/缩写/改视角/钩子/标题/摘要 | V1 | verified | #116 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-002` | M1 |
| GEN-003 | 事实抽取/提案/来源句 | V1 | verified | #77 | #77 | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-003` | M0 |
| GEN-004 | 连续性/文风/读者 Critic | V1 | verified | #117 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-004` | M1 |
| GEN-005 | 两轮定向修订 | V1 | verified | #118 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-005` | M1 |
| GEN-006 | 正史提交/Canon Curator | V1 | verified | #78 | #78 | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-006` | M0 |
| GEN-007 | 按章/卷/区间/全本批量 | V1 | verified | #151 | #91 package integration | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-007` | M2 |
| GEN-008 | 父子任务/暂停/恢复/取消/重试 | V1 | verified | #152 | #91 package integration | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-008` | M2 |
| GEN-009 | 黄金三章候选/确认/锁定 | V1 | verified | #147 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-009` | M1 |
| GEN-010 | 卷级验收/自动通过/审核队列 | V1 | verified | #149 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-010` | M2 |
| GEN-011 | 成本/吞吐/失败报告 | V1 | verified | #150 | — | M0 Spec #66; M0 Protocol Freeze §§5–9; Generation contract; ADR 0017 | `docs/implementation/m3-236-non-ui-capability-evidence.json#GEN-011` | M2 |
| QUALITY-001 | 六维质量报告 | V1 | verified | #117 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-001` | M1 |
| QUALITY-002 | 冲突证据/批注/忽略原因 | V1 | verified | #117 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-002` | M1 |
| QUALITY-003 | 事实确认/驳回/修改 | V1 | verified | #77 | #78 | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-003` | M0 |
| QUALITY-004 | 审核队列/批准/驳回/批量 | V1 | verified | #149 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-004` | M2 |
| QUALITY-005 | 黄金三章/卷末验收 | V1 | verified | #90 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-005` | M1 |
| QUALITY-006 | 固定基准集/回归门禁 | V1 | verified | #139 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-006` | M3 |
| QUALITY-007 | 作者反馈记录 | V1 | verified | #118 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-007` | M1 |
| QUALITY-008 | 人物声线/风格漂移检查 | V1 | verified | #119 | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#QUALITY-008` | M1 |
| QUALITY-009 | 真实读者反馈 | 后续 | deferred | — | — | M1–M3 specs #80–#82; Review/Eval contract; ADR 0017, 0022 | ReaderFeedback; 后续 | Post-V1 |
| CHANGE-001 | 修改请求/原因/差异/来源 | V1 | verified | #120 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-001` | M2 |
| CHANGE-002 | 影响分析/六项检查 | V1 | verified | #121 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-002` | M2 |
| CHANGE-003 | 应用/撤销修改 | V1 | verified | #122 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-003` | M2 |
| CHANGE-004 | 任意版本点拉平行版本 | V1 | verified | #123 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-004` | M2 |
| CHANGE-005 | 正文/事实/设定/大纲/伏笔比较 | V1 | verified | #124 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-005` | M2 |
| CHANGE-006 | 逐对象摘取/合并 | V1 | verified | #124 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-006` | M2 |
| CHANGE-007 | 高风险合并门禁 | V1 | verified | #125 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-007` | M2 |
| CHANGE-008 | 回滚新版本/审计 | V1 | verified | #125 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-008` | M2 |
| CHANGE-009 | 全局当前分支/分支切换 | V1 | verified | #123 | — | M2 Spec #81; Changes/version contract; ADR 0016, 0020 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CHANGE-009` | M2 |
| IO-001 | TXT/Markdown/DOCX 解析/切分/合并/拆分 | V1 | verified | #126 | #72 | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-001` | M2 |
| IO-002 | 可选设定提取/候选/冲突/报告 | V1 | verified | #127 | #71 | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-002` | M2 |
| IO-003 | 导入后台任务/断点/进度 | V1 | verified | #126 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-003` | M2 |
| IO-004 | 导出格式/范围/历史/下载/过期 | V1 | verified | #129 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-004` | M3 |
| IO-005 | 发布检查/预览/文案/标签 | V1 | verified | #130 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-005` | M3 |
| IO-006 | 账号完整导出 | V1 | verified | #134 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-006` | M3 |
| IO-007 | 备份/恢复/孤儿清理 | V1 | verified | #136 | — | M0/M2/M3 specs; Import/Export contracts; ADR 0018, 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#IO-007` | M3 |
| SEARCH-001 | 跨作品/作品内全局搜索 | V1 | verified | #128 | — | Backend design §1.2 and ContextModule; ADR 0018, 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEARCH-001` | M2 |
| SEARCH-002 | 全文索引/更新/重建 | V1 | verified | #128 | — | Backend design §1.2 and ContextModule; ADR 0018, 0019 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEARCH-002` | M2 |
| NOTIFY-001 | 站内通知/审核提醒/已读 | V1 | verified | #97 | — | M2 Spec #81; NotificationModule contract | `docs/implementation/m3-236-non-ui-capability-evidence.json#NOTIFY-001` | M2 |
| SEC-001 | BYOK 加密/掩码/白名单/SSRF 防护 | V1 | verified | #69 | #69 | ADR 0023; M0 Protocol Freeze §§3, 8 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEC-001` | M0 |
| SEC-002 | RLS/租户隔离 | V1 | verified | #132 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEC-002` | M3 |
| SEC-003 | 日志脱敏/追踪默认关闭 | V1 | verified | #133 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEC-003` | M3 |
| SEC-004 | 删除/备份过期/孤儿数据清理 | V1 | verified | #134 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEC-004` | M3 |
| SEC-005 | 内容安全/AI 标识/申诉 | V1 | verified | #131 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEC-005` | M3 |
| SEC-006 | 限流/审计/无管理员越权 | V1 | verified | #132 | — | ADR 0023; M0 Protocol Freeze §§3, 8 | `docs/implementation/m3-236-non-ui-capability-evidence.json#SEC-006` | M3 |
| UI-001 | 页面/动作/API/状态矩阵 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-001`; 17 页 action evidence 无 pending，matrix 与 gate 一致 | M0–M3 |
| UI-002 | 设计令牌/组件清单 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-002`; token/component guardrail | M0–M3 |
| UI-003 | 7 栏/3 题材/统一状态枚举 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-003`; contract/spec guardrail | M0–M3 |
| UI-004 | 逐页 loading/empty/error/disabled/permission/partial/long | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-004`; help 路由错误态/重试恢复已由 #220 验证 | M0–M3 |
| UI-005 | 1440/1180/900/390 响应式 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-005`; 17 页四档 Playwright 与 Golden | M0–M3 |
| UI-006 | Playwright 结构/截图基线 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-006`; 68 张 Golden 与 Production CI | M0–M3 |
| UI-007 | Agent UX：本章参考/来源/冲突/修订/成本/失败/确认 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-007`; writing/batch/changes 真实动作证据 | M0–M3 |
| UI-008 | 导入报告/黄金三章/分支比较页面 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-008`; new-project/outline/changes 页面证据 | M0–M3 |
| UI-009 | 作者语言/无内部术语/prototype_only 登记 | V1 | verified | #104 | #238 + #79 + page feature issues | Prototype Contract; V1 Prototype Sign-off; UI Parity Matrix | `docs/implementation/m3-238-ui-capability-evidence.json#UI-009`; 全页 author-language/prototype-only 扫描 | M0–M3 |
| OPS-001 | 健康检查/局域网与云部署 | V1 | verified | #135 | #67 | Backend design §§11–13; ADR 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#OPS-001` | M3 |
| OPS-002 | 备份/恢复演练 | V1 | verified | #136 | — | Backend design §§11–13; ADR 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#OPS-002` | M3 |
| OPS-003 | 监控/日志/成本告警 | V1 | verified | #135 | — | Backend design §§11–13; ADR 0023 | `docs/implementation/m3-236-non-ui-capability-evidence.json#OPS-003` | M3 |
| EVAL-001 | 三题材 + 长线基准集 | V1 | verified | #139 | #79 | M3 Spec #82; EvalModule; ADR 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#EVAL-001` | M3 |
| EVAL-002 | 评分 rubric/阈值/回归 | V1 | implemented | #139 | — | M3 Spec #82; EvalModule; ADR 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#EVAL-002`; `docs/quality/evidence/m3-240/review-policy.json`; `scripts/test/m3-240-variance-threshold.test.mjs`; release-head CI gap #242 | M3 |
| EVAL-003 | 真实 DeepSeek smoke | V1 | verified | #140 | #79, #241 | M3 Spec #82; EvalModule; ADR 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#EVAL-003`; [protected run 45557765302](https://github.com/ruifeng-y/novel-brain/actions/runs/45557765302) | M3 |
| EVAL-004 | Prompt/模型灰度与回滚 | V1 | implemented | #140 | #241 | M3 Spec #82; EvalModule; ADR 0022 | `docs/implementation/m3-236-non-ui-capability-evidence.json#EVAL-004`; model alias gap #271 | M3 |
| PERF-001 | 1000 万字容量/性能/恢复基准 | 后续 | deferred | — | #91/#93/#95/#96/#128/#135/#136 | Backend design §§12–13; #137 | 产品决定 V1 不声明 10M 容量；未来重启需重新认证 | Post-V1 |
| CONT-001 | 3000–4000 章跨卷叙事连续性基准 | V1 | implemented | #138 | #106–#119/#86/#90/#115/#239/#273 | ADR 0017/0019/0022; #138 | `docs/implementation/m3-236-non-ui-capability-evidence.json#CONT-001`; `docs/quality/evidence/m3-239/validation.json`; `docs/quality/evidence/m3-273/status.json`; proposed 204-sample cleanup, 0/24 real adjudications; hook/prose 1.882353 < 4; gap #273 | M3 |

## 强制规则

1. Manifest 与本表按 ID 一一对应；每个 V1 ID 恰有一个 Primary issue。无主责只能是明确的 `deferred`，并记录理由和后续边界。
2. Primary issue 必须是具体实现任务或明确的 cross-cutting release gate；package/epic parent 不能被误标为单次实现 ticket。
3. 任一 issue 的 Capability IDs 必须与本表主责归属一致；跨任务引用写在 Supporting 或 Dependencies，不重复取得主责。
4. 每个 leaf issue 必须链接设计来源、受影响 API/DB/Worker/UI 面、可执行测试类型和可复现验收证据。
5. `mapped` 不等于 `ready`。依赖全部满足后才允许 /implement；不得仅凭 issue 存在或标签开始。
6. `implemented` 不等于 `verified`；发布前必须提供机器测试结果、人工签收或基准报告。
7. AGENT-007（向量检索增强）与 QUALITY-009（真实读者反馈）保持 post-V1/deferred，不得用假接口计入 V1；授权记录见 `docs/planning/v1-deferrals.json` 与 ADR 0028。
8. PERF-001 已明确延期，不属于 V1 发布承诺；CONT-001 的评分证据已由 #239 收口且阈值已由 #240 批准，但 #273 的 24 个真实裁决、清洗包/旧评分影响和 hook/prose 处置，以及 #271 模型身份证据和 #242 release-head CI 收口仍是 #104 发布阻塞项。任何未登记解除 V1 归属的能力都会使 release gate 失败。
