# V1 Capability Manifest v2

> 状态：V1 delivery scope baseline v2（2026-11-04）。本版保留 117 个原始能力，并新增两个独立的跨切面发布门禁：PERF-001 与 CONT-001。
>
> 优先级：ADR 0010–0024 > 需求/技术/原型中的旧条款。发现冲突时，先更新基线，再进入 `/to-spec`。

## 1. 使用规则

- 每个能力必须有唯一 ID。
- 每个能力必须映射到原型页面/动作、后端/数据、验收证据和里程碑。
- 没有能力归属的 ticket 不允许创建；没有 ticket 的能力不允许消失。
- `V1` 是必须交付；`后续` 是明确延后、不能伪装成 V1；`原型专用` 不能进入生产。
- MVP 是里程碑，不是缩减范围；所有 V1 能力最终都必须有 ticket。

## 2. 账号与访问

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| ACCT-001 | 邮箱验证码注册/登录 | V1 | auth | Auth/Users | API + E2E 注册登录 |
| ACCT-002 | 密码重置/账号恢复 | V1 | auth | Auth | 邮件链接 + 恢复 E2E |
| ACCT-003 | 会话列表/退出所有设备 | V1 | account-settings | Auth/Sessions | 会话撤销 E2E |
| ACCT-004 | 显示资料/多笔名 | V1 | account-settings | Users/PenNames | API + UI |
| ACCT-005 | 账号完整导出 | V1 | account-settings | Users/Export | 下载包内容校验 |
| ACCT-006 | 注销/30 天恢复/永久删除 | V1 | account-settings | Users/Purge | 生命周期 E2E |
| ACCT-007 | BYOK 模型配置/用途路由 | V1 | account-settings | ModelConfigs | 加密/掩码/用途 |
| ACCT-008 | 模型连接测试/错误状态 | V1 | account-settings | ModelConfigs | 成功/失败/限流 |
| ACCT-009 | 限流/安全状态/无管理员越权 | V1 | auth/account-settings | Auth/Security | 安全 E2E |

## 3. 作品与开书

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| WORK-001 | 从想法/空白/模板/部分或完整设定创建作品 | V1 | new-project | Works/StoryBible | 五种入口 E2E |
| WORK-002 | 默认文本导入：解析/切分/标题/保留原文 | V1 | new-project/import | Import | 大文件 + 断点 |
| WORK-003 | 可选设定提取：候选/冲突/报告/确认 | V1 | import | Import/Canon | 候选确认 E2E |
| WORK-004 | 作品列表/搜索/筛选/排序 | V1 | dashboard | Works/Search | 长列表 + 搜索 |
| WORK-005 | 作品总览/进度/最近修改 | V1 | work-overview | Works/Jobs | 聚合数据 |
| WORK-006 | 归档/恢复/回收站/删除 | V1 | dashboard/work-settings | Works | 生命周期 E2E |
| WORK-007 | 复制作品，默认不复制正文和版本 | V1 | work-settings | Works | 默认值校验 |
| WORK-008 | 作品设置/封面/标签/连载状态 | V1 | work-settings | Works/Storage | API + UI |
| WORK-009 | 全站当前作品 + 当前平行版本上下文 | V1 | shell | Works/Branches | 切换一致性 E2E |
| ONBOARD-001 | 故事罗盘/故事蓝图 | V1 | new-project/bible | StoryBible/Planner | 生成 + 确认 |
| ONBOARD-002 | 九卡故事圣经/版本/锁定 | V1 | bible | StoryBible | 版本 + 锁定 |
| ONBOARD-003 | 题材包：仙侠/历史/都市 | V1 | new-project/settings | GenrePacks | 三题材差异测试 |
| ONBOARD-004 | 世界铁律/硬规则 | V1 | bible | Canon/StoryBible | 规则校验 |
| ONBOARD-005 | 核心人物/关系/人物弧 | V1 | settings/bible | Characters/Relations | 关系图 |
| ONBOARD-006 | 主线/支线/伏笔计划 | V1 | outline/foreshadows | StoryLedger | 计划 + 账本 |
| ONBOARD-007 | 全书/卷/幕/章/场景大纲 | V1 | outline | Outline | 五层树 |
| ONBOARD-008 | 设定冻结/开书门禁 | V1 | bible/outline | StoryBible/Readiness | 门禁 E2E |

## 4. 设定中心

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| SET-001 | 7 个设定顶层栏目 | V1 | settings | Settings | 信息架构 |
| SET-002 | 实体/别名/自定义字段 | V1 | settings/entity-detail | Entities/CustomFields | CRUD + 迁移 |
| SET-003 | 实体关系/有效期 | V1 | settings/entity-detail | Relations | 关系图 |
| SET-004 | 势力/控制区/关系 | V1 | settings/entity-detail | Factions/Relations | 控制区冲突 |
| SET-005 | 地图节点/连接/旅行时间/标记 | V1 | settings/entity-detail | Maps | 地图 E2E |
| SET-006 | 力量体系/境界/突破/代价 | V1 | settings/entity-detail | PowerSystem | 战力校验 |
| SET-007 | 金手指/规则/代价/成长 | V1 | settings/entity-detail | GoldenFinger | 规则校验 |
| SET-008 | 物品功法/归属/流转 | V1 | settings/entity-detail | Items/Ownership | 归属校验 |
| SET-009 | 时间线/纪元/事件/行程 | V1 | settings/entity-detail | Timeline | 时间冲突 |
| SET-010 | 人物档案/状态/认知/声线 | V1 | entity-detail | Characters/Knowledge | 知识边界 |
| SET-011 | 设定状态：草稿/提案/锁定/废弃 | V1 | settings | Settings/Canon | 状态机 |
| SET-012 | 设定提案/冲突证据/引用 | V1 | settings | Canon/Critics | 提案 E2E |

## 5. 大纲与规划

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| PLAN-001 | 大纲树/看板/张力曲线 | V1 | outline | Outline | 五层视图 |
| PLAN-002 | 大纲重排/锁定/版本 | V1 | outline | Outline | 版本 + 锁定 |
| PLAN-003 | 黄金三章/开篇策略 | V1 | outline | Outline/GoldenThree | 候选 + 门禁 |
| PLAN-004 | 伏笔账本/剧情线/人物弧 | V1 | foreshadows | StoryLedger | CRUD + 检查 |
| PLAN-005 | 生成准备度检查 | V1 | outline/writing | Readiness | 缺项提示 |
| PLAN-006 | 卷/幕契约与重规划触发 | V1 | outline | Planner | 偏离报告 |
| PLAN-007 | 场景卡/节拍/信息释放 | V1 | outline/writing | Outline/Scene | 场景生成 |

## 6. Agent Runtime 与上下文

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| AGENT-001 | Agent 角色/I/O 契约 | V1 | writing/batch | Agents | Schema + 契约测试 |
| AGENT-002 | 确定性编排器状态机 | V1 | batch/writing | Orchestrator | 状态机 E2E |
| AGENT-003 | 工具白名单/读写权限 | V1 | writing/batch | Agents/Tools | 越权测试 |
| AGENT-004 | P0–P4 ContextPack 编译 | V1 | writing | ContextCompiler | 来源/淘汰 |
| AGENT-005 | 关键事实固定/自适应预算 | V1 | writing | ContextCompiler | P0 不丢失 |
| AGENT-006 | 结构化检索/实体图/别名扩展 | V1 | writing/settings | Search/Context | 召回测试 |
| AGENT-007 | 向量检索增强 | 后续 | writing | Search/Vector | Phase 2 |
| AGENT-008 | 分层摘要/失效重算 | V1 | writing/batch | Summaries/Index | 重建 E2E |
| AGENT-009 | Prompt/模型版本/参数记录 | V1 | writing/batch | Agents/ModelCalls | 轨迹可回放 |
| AGENT-010 | 生成轨迹/成本/失败升级 | V1 | writing/batch | Trace/Eval | 轨迹查询 |
| AGENT-011 | 幂等/重试/检查点/人工恢复 | V1 | batch | Jobs/Agents | 断点恢复 E2E |

## 7. 生成、评审与修订

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| GEN-001 | 单章生成 | V1 | writing | Generation | 生成 E2E |
| GEN-002 | 续写/改写/扩写/缩写/改视角/钩子/标题/摘要 | V1 | writing | Generation | 每种动作 E2E |
| GEN-003 | 事实抽取/提案/来源句 | V1 | writing | Facts/Proposals | 来源可追溯 |
| GEN-004 | 连续性/文风/读者 Critic | V1 | writing | Critics | 结构化问题 |
| GEN-005 | 两轮定向修订 | V1 | writing | Reviser | 修订差异 |
| GEN-006 | 正史提交/Canon Curator | V1 | writing/changes | Canon | 门禁 E2E |
| GEN-007 | 按章/卷/区间/全本批量 | V1 | batch | BatchJobs | 任务 E2E |
| GEN-008 | 父子任务/暂停/恢复/取消/重试 | V1 | batch | Jobs | 重启恢复 |
| GEN-009 | 黄金三章候选/确认/锁定 | V1 | outline/writing | GoldenThree | 候选对比 |
| GEN-010 | 卷级验收/自动通过/审核队列 | V1 | batch | Review/Jobs | 高风险门禁 |
| GEN-011 | 成本/吞吐/失败报告 | V1 | batch | Usage/Reports | 单章/单卷 |

## 8. 质量与评测

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| QUALITY-001 | 六维质量报告 | V1 | writing | Quality | 六维证据 |
| QUALITY-002 | 冲突证据/批注/忽略原因 | V1 | writing | Critics/Annotations | 问题生命周期 |
| QUALITY-003 | 事实确认/驳回/修改 | V1 | writing | Facts/Proposals | 逐条确认 |
| QUALITY-004 | 审核队列/批准/驳回/批量 | V1 | batch | Review | 批量低风险 |
| QUALITY-005 | 黄金三章/卷末验收 | V1 | outline/batch | Gates | 作者签收 |
| QUALITY-006 | 固定基准集/回归门禁 | V1 | — | Eval | 三题材 + 长线 |
| QUALITY-007 | 作者反馈记录 | V1 | writing | Feedback | 接受/拒绝/改写 |
| QUALITY-008 | 人物声线/风格漂移检查 | V1 | writing | Style/Characters | 卷级检查 |
| QUALITY-009 | 真实读者反馈 | 后续 | — | ReaderFeedback | 后续 |

## 9. 修改、版本与合并

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| CHANGE-001 | 修改请求/原因/差异/来源 | V1 | changes | Changes | 请求 E2E |
| CHANGE-002 | 影响分析/六项检查 | V1 | changes | Changes | 冲突分类 |
| CHANGE-003 | 应用/撤销修改 | V1 | changes | Changes/Canon | 应用 E2E |
| CHANGE-004 | 任意版本点拉平行版本 | V1 | changes | Branches | 独立正史 |
| CHANGE-005 | 正文/事实/设定/大纲/伏笔比较 | V1 | changes | Branches | 逐对象差异 |
| CHANGE-006 | 逐对象摘取/合并 | V1 | changes | Branches/Canon | 冲突确认 |
| CHANGE-007 | 高风险合并门禁 | V1 | changes | Gates | 不可绕过 |
| CHANGE-008 | 回滚新版本/审计 | V1 | changes | Versions/Audit | 历史保留 |
| CHANGE-009 | 全局当前分支/分支切换 | V1 | shell/changes | Branches | 数据一致 |

## 10. 导入、导出与发布

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| IO-001 | TXT/Markdown/DOCX 解析/切分/合并/拆分 | V1 | new-project/import | Import | 文件矩阵 |
| IO-002 | 可选设定提取/候选/冲突/报告 | V1 | import | Import/Canon | 报告 E2E |
| IO-003 | 导入后台任务/断点/进度 | V1 | import | Jobs/Import | 千万字夹具 |
| IO-004 | 导出格式/范围/历史/下载/过期 | V1 | export-publish | Exports/Storage | 全格式 E2E |
| IO-005 | 发布检查/预览/文案/标签 | V1 | export-publish | Publish | 检查 + 预览 |
| IO-006 | 账号完整导出 | V1 | account-settings | Users/Export | 包内容校验 |
| IO-007 | 备份/恢复/孤儿清理 | V1 | — | Ops/Storage | 恢复演练 |

## 11. 搜索与通知

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| SEARCH-001 | 跨作品/作品内全局搜索 | V1 | shell | Search | 中文检索 |
| SEARCH-002 | 全文索引/更新/重建 | V1 | — | Search/Index | 提交后更新 |
| NOTIFY-001 | 站内通知/审核提醒/已读 | V1 | shell | Notifications | 任务通知 |

## 12. 安全与数据生命周期

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | BYOK 加密/掩码/白名单/SSRF 防护 | V1 | account-settings | Security/ModelConfigs | 安全 E2E |
| SEC-002 | RLS/租户隔离 | V1 | — | Database/RLS | 跨用户测试 |
| SEC-003 | 日志脱敏/追踪默认关闭 | V1 | — | Observability | 日志检查 |
| SEC-004 | 删除/备份过期/孤儿数据清理 | V1 | account-settings | Jobs/Storage | 删除 SLA |
| SEC-005 | 内容安全/AI 标识/申诉 | V1 | legal/export-publish | Moderation | 内容治理 |
| SEC-006 | 限流/审计/无管理员越权 | V1 | auth | Security/Audit | 安全回归 |

## 13. UI 与原型契约

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| UI-001 | 页面/动作/API/状态矩阵 | V1 | all | — | 矩阵完整 |
| UI-002 | 设计令牌/组件清单 | V1 | all | — | 组件对照 |
| UI-003 | 7 栏/3 题材/统一状态枚举 | V1 | settings/new-project | — | 信息架构 |
| UI-004 | 逐页 loading/empty/error/disabled/permission/partial/long | V1 | all | — | 状态矩阵 |
| UI-005 | 1440/1180/900/390 响应式 | V1 | all | — | Playwright 截图 |
| UI-006 | Playwright 结构/截图基线 | V1 | all | — | CI 门禁 |
| UI-007 | Agent UX：本章参考/来源/冲突/修订/成本/失败/确认 | V1 | writing/batch/changes | — | 页面验收 |
| UI-008 | 导入报告/黄金三章/分支比较页面 | V1 | import/outline/changes | — | 页面验收 |
| UI-009 | 作者语言/无内部术语/prototype_only 登记 | V1 | all | — | 术语扫描 |

## 14. 运维与评测

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| OPS-001 | 健康检查/局域网与云部署 | V1 | — | Ops/Deploy | 部署 smoke |
| OPS-002 | 备份/恢复演练 | V1 | — | Ops/Backup | RPO/RTO |
| OPS-003 | 监控/日志/成本告警 | V1 | — | Observability | 告警演练 |
| EVAL-001 | 三题材 + 长线基准集 | V1 | — | Eval | 固定数据集 |
| EVAL-002 | 评分 rubric/阈值/回归 | V1 | — | Eval | 发布门禁 |
| EVAL-003 | 真实 DeepSeek smoke | V1 | — | Eval/AI | 连接与质量 |
| EVAL-004 | Prompt/模型灰度与回滚 | V1 | — | Eval/Agents | 版本治理 |

## 15. Cross-cutting scale and continuity gates

| ID | 能力 | 范围 | 原型 | 后端/数据 | 验收 |
| --- | --- | --- | --- | --- | --- |
| PERF-001 | 1000 万字容量/性能/恢复基准 | V1 | — | Perf/Storage/Search/Jobs | 固定 10M fixture、负载模型、p50/p95/p99、资源/成本/容量和恢复报告 |
| CONT-001 | 3000–4000 章跨卷叙事连续性基准 | V1 | writing/settings/outline | Continuity/Eval/Canon/Knowledge | Ground-truth 跨卷 fixture、知识边界/状态不变量/伏笔/分支验证与人工盲评 |

PERF-001 与 CONT-001 是互不替代的发布门禁：容量测试不证明叙事正确，长线内容评分也不证明数据库、索引和恢复满足容量目标。

## 16. 覆盖规则

- 每个 V1 能力必须有至少一个 ticket；每个 ticket 至少引用一个 V1 能力。
- 每个 V1 能力必须有原型页面/动作或明确标记为“无 UI（后台能力）”。
- 每个 V1 能力必须有验收证据：API/Worker、E2E、截图/结构断言、评测或恢复演练。
- `后续` 能力不能出现在 V1 发布门禁中，也不能用“先做假接口”方式提前交付。
- `原型专用` 能力必须列在 UI 矩阵中，禁止进入生产 UI。
