# V1 Capability Traceability v1

> 状态：v1，作为 `/to-tickets` 的能力账本。
> 规则：只有 `verified` 才算完成；`implemented` 只代表代码存在；`deferred` 必须明确原因和授权。
> 进入 `/to-tickets` 前，`unmapped` 是预期状态，表示能力已确认但 ticket 尚未生成；ticket 生成后不允许继续保留 `unmapped`。

## 状态图例

- `unmapped`：能力存在，但尚未映射 ticket。
- `mapped`：已有 ticket 和负责人。
- `ticketed`：ticket 已进入 ready-for-agent。
- `in_progress`：正在实现。
- `implemented`：代码存在，未验证。
- `verified`：API/数据/UI/E2E/评测证据齐全。
- `released`：通过发布门禁。
- `blocked` / `deferred` / `stub` / `retired`：必须记录原因、owner 和到期里程碑。

## 能力账本

| ID | 能力 | 范围 | 状态 | 主 ticket | API/数据 | 原型 | 验收 | 依赖 | 里程碑 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACCT-001 | 邮箱验证码注册/登录 | V1 | unmapped | TBD | Auth/Users | auth | API + E2E 注册登录 | — | M0 |
| ACCT-002 | 密码重置/账号恢复 | V1 | unmapped | TBD | Auth | auth | 邮件链接 + 恢复 E2E | — | M0 |
| ACCT-003 | 会话列表/退出所有设备 | V1 | unmapped | TBD | Auth/Sessions | account-settings | 会话撤销 E2E | — | M0 |
| ACCT-004 | 显示资料/多笔名 | V1 | unmapped | TBD | Users/PenNames | account-settings | API + UI | — | M0 |
| ACCT-005 | 账号完整导出 | V1 | unmapped | TBD | Users/Export | account-settings | 下载包内容校验 | — | M0 |
| ACCT-006 | 注销/30 天恢复/永久删除 | V1 | unmapped | TBD | Users/Purge | account-settings | 生命周期 E2E | — | M0 |
| ACCT-007 | BYOK 模型配置/用途路由 | V1 | unmapped | TBD | ModelConfigs | account-settings | 加密/掩码/用途 | — | M0 |
| ACCT-008 | 模型连接测试/错误状态 | V1 | unmapped | TBD | ModelConfigs | account-settings | 成功/失败/限流 | — | M0 |
| ACCT-009 | 限流/安全状态/无管理员越权 | V1 | unmapped | TBD | Auth/Security | auth/account-settings | 安全 E2E | — | M0 |
| WORK-001 | 从想法/空白/模板/部分或完整设定创建作品 | V1 | unmapped | TBD | Works/StoryBible | new-project | 五种入口 E2E | — | M0 |
| WORK-002 | 默认文本导入：解析/切分/标题/保留原文 | V1 | unmapped | TBD | Import | new-project/import | 大文件 + 断点 | — | M0 |
| WORK-003 | 可选设定提取：候选/冲突/报告/确认 | V1 | unmapped | TBD | Import/Canon | new-project (导入视图) | 候选确认 E2E | — | M0 |
| WORK-004 | 作品列表/搜索/筛选/排序 | V1 | unmapped | TBD | Works/Search | dashboard | 长列表 + 搜索 | — | M0 |
| WORK-005 | 作品总览/进度/最近修改 | V1 | unmapped | TBD | Works/Jobs | work-overview | 聚合数据 | — | M0 |
| WORK-006 | 归档/恢复/回收站/删除 | V1 | unmapped | TBD | Works | dashboard/work-settings | 生命周期 E2E | — | M0 |
| WORK-007 | 复制作品，默认不复制正文和版本 | V1 | unmapped | TBD | Works | work-settings | 默认值校验 | — | M0 |
| WORK-008 | 作品设置/封面/标签/连载状态 | V1 | unmapped | TBD | Works/Storage | work-settings | API + UI | — | M0 |
| WORK-009 | 全站当前作品 + 当前平行版本上下文 | V1 | unmapped | TBD | Works/Branches | 全局壳层 | 切换一致性 E2E | — | M0 |
| ONBOARD-001 | 故事罗盘/故事蓝图 | V1 | unmapped | TBD | StoryBible/Planner | new-project/bible | 生成 + 确认 | — | M1 |
| ONBOARD-002 | 九卡故事圣经/版本/锁定 | V1 | unmapped | TBD | StoryBible | bible | 版本 + 锁定 | — | M1 |
| ONBOARD-003 | 题材包：仙侠/历史/都市 | V1 | unmapped | TBD | GenrePacks | new-project/settings | 三题材差异测试 | — | M1 |
| ONBOARD-004 | 世界铁律/硬规则 | V1 | unmapped | TBD | Canon/StoryBible | bible | 规则校验 | — | M1 |
| ONBOARD-005 | 核心人物/关系/人物弧 | V1 | unmapped | TBD | Characters/Relations | settings/bible | 关系图 | — | M1 |
| ONBOARD-006 | 主线/支线/伏笔计划 | V1 | unmapped | TBD | StoryLedger | outline/foreshadows | 计划 + 账本 | — | M1 |
| ONBOARD-007 | 全书/卷/幕/章/场景大纲 | V1 | unmapped | TBD | Outline | outline | 五层树 | — | M1 |
| ONBOARD-008 | 设定冻结/开书门禁 | V1 | unmapped | TBD | StoryBible/Readiness | bible/outline | 门禁 E2E | — | M1 |
| SET-001 | 7 个设定顶层栏目 | V1 | unmapped | TBD | Settings | settings | 信息架构 | — | M1 |
| SET-002 | 实体/别名/自定义字段 | V1 | unmapped | TBD | Entities/CustomFields | settings/entity-detail | CRUD + 迁移 | — | M1 |
| SET-003 | 实体关系/有效期 | V1 | unmapped | TBD | Relations | settings/entity-detail | 关系图 | — | M1 |
| SET-004 | 势力/控制区/关系 | V1 | unmapped | TBD | Factions/Relations | settings/entity-detail | 控制区冲突 | — | M1 |
| SET-005 | 地图节点/连接/旅行时间/标记 | V1 | unmapped | TBD | Maps | settings/entity-detail | 地图 E2E | — | M1 |
| SET-006 | 力量体系/境界/突破/代价 | V1 | unmapped | TBD | PowerSystem | settings/entity-detail | 战力校验 | — | M1 |
| SET-007 | 金手指/规则/代价/成长 | V1 | unmapped | TBD | GoldenFinger | settings/entity-detail | 规则校验 | — | M1 |
| SET-008 | 物品功法/归属/流转 | V1 | unmapped | TBD | Items/Ownership | settings/entity-detail | 归属校验 | — | M1 |
| SET-009 | 时间线/纪元/事件/行程 | V1 | unmapped | TBD | Timeline | settings/entity-detail | 时间冲突 | — | M1 |
| SET-010 | 人物档案/状态/认知/声线 | V1 | unmapped | TBD | Characters/Knowledge | entity-detail | 知识边界 | — | M1 |
| SET-011 | 设定状态：草稿/提案/锁定/废弃 | V1 | unmapped | TBD | Settings/Canon | settings | 状态机 | — | M1 |
| SET-012 | 设定提案/冲突证据/引用 | V1 | unmapped | TBD | Canon/Critics | settings | 提案 E2E | — | M1 |
| PLAN-001 | 大纲树/看板/张力曲线 | V1 | unmapped | TBD | Outline | outline | 五层视图 | — | M1 |
| PLAN-002 | 大纲重排/锁定/版本 | V1 | unmapped | TBD | Outline | outline | 版本 + 锁定 | — | M1 |
| PLAN-003 | 黄金三章/开篇策略 | V1 | unmapped | TBD | Outline/GoldenThree | outline | 候选 + 门禁 | — | M1 |
| PLAN-004 | 伏笔账本/剧情线/人物弧 | V1 | unmapped | TBD | StoryLedger | foreshadows | CRUD + 检查 | — | M1 |
| PLAN-005 | 生成准备度检查 | V1 | unmapped | TBD | Readiness | outline/writing | 缺项提示 | — | M1 |
| PLAN-006 | 卷/幕契约与重规划触发 | V1 | unmapped | TBD | Planner | outline | 偏离报告 | — | M1 |
| PLAN-007 | 场景卡/节拍/信息释放 | V1 | unmapped | TBD | Outline/Scene | outline/writing | 场景生成 | — | M1 |
| AGENT-001 | Agent 角色/I/O 契约 | V1 | unmapped | TBD | Agents | writing/batch | Schema + 契约测试 | — | M2 |
| AGENT-002 | 确定性编排器状态机 | V1 | unmapped | TBD | Orchestrator | batch/writing | 状态机 E2E | — | M2 |
| AGENT-003 | 工具白名单/读写权限 | V1 | unmapped | TBD | Agents/Tools | writing/batch | 越权测试 | — | M2 |
| AGENT-004 | P0–P4 ContextPack 编译 | V1 | unmapped | TBD | ContextCompiler | writing | 来源/淘汰 | — | M2 |
| AGENT-005 | 关键事实固定/自适应预算 | V1 | unmapped | TBD | ContextCompiler | writing | P0 不丢失 | — | M2 |
| AGENT-006 | 结构化检索/实体图/别名扩展 | V1 | unmapped | TBD | Search/Context | writing/settings | 召回测试 | — | M2 |
| AGENT-007 | 向量检索增强 | 后续 | unmapped | TBD | Search/Vector | writing | Phase 2 | — | M2 |
| AGENT-008 | 分层摘要/失效重算 | V1 | unmapped | TBD | Summaries/Index | writing/batch | 重建 E2E | — | M2 |
| AGENT-009 | Prompt/模型版本/参数记录 | V1 | unmapped | TBD | Agents/ModelCalls | writing/batch | 轨迹可回放 | — | M2 |
| AGENT-010 | 生成轨迹/成本/失败升级 | V1 | unmapped | TBD | Trace/Eval | writing/batch | 轨迹查询 | — | M2 |
| AGENT-011 | 幂等/重试/检查点/人工恢复 | V1 | unmapped | TBD | Jobs/Agents | batch | 断点恢复 E2E | — | M2 |
| GEN-001 | 单章生成 | V1 | unmapped | TBD | Generation | writing | 生成 E2E | — | M1 |
| GEN-002 | 续写/改写/扩写/缩写/改视角/钩子/标题/摘要 | V1 | unmapped | TBD | Generation | writing | 每种动作 E2E | — | M1 |
| GEN-003 | 事实抽取/提案/来源句 | V1 | unmapped | TBD | Facts/Proposals | writing | 来源可追溯 | — | M1 |
| GEN-004 | 连续性/文风/读者 Critic | V1 | unmapped | TBD | Critics | writing | 结构化问题 | — | M1 |
| GEN-005 | 两轮定向修订 | V1 | unmapped | TBD | Reviser | writing | 修订差异 | — | M1 |
| GEN-006 | 正史提交/Canon Curator | V1 | unmapped | TBD | Canon | writing/changes | 门禁 E2E | — | M1 |
| GEN-007 | 按章/卷/区间/全本批量 | V1 | unmapped | TBD | BatchJobs | batch | 任务 E2E | — | M1 |
| GEN-008 | 父子任务/暂停/恢复/取消/重试 | V1 | unmapped | TBD | Jobs | batch | 重启恢复 | — | M1 |
| GEN-009 | 黄金三章候选/确认/锁定 | V1 | unmapped | TBD | GoldenThree | outline/writing | 候选对比 | — | M1 |
| GEN-010 | 卷级验收/自动通过/审核队列 | V1 | unmapped | TBD | Review/Jobs | batch | 高风险门禁 | — | M1 |
| GEN-011 | 成本/吞吐/失败报告 | V1 | unmapped | TBD | Usage/Reports | batch | 单章/单卷 | — | M1 |
| QUALITY-001 | 六维质量报告 | V1 | unmapped | TBD | Quality | writing | 六维证据 | — | M2 |
| QUALITY-002 | 冲突证据/批注/忽略原因 | V1 | unmapped | TBD | Critics/Annotations | writing | 问题生命周期 | — | M2 |
| QUALITY-003 | 事实确认/驳回/修改 | V1 | unmapped | TBD | Facts/Proposals | writing | 逐条确认 | — | M2 |
| QUALITY-004 | 审核队列/批准/驳回/批量 | V1 | unmapped | TBD | Review | batch | 批量低风险 | — | M2 |
| QUALITY-005 | 黄金三章/卷末验收 | V1 | unmapped | TBD | Gates | outline/batch | 作者签收 | — | M2 |
| QUALITY-006 | 固定基准集/回归门禁 | V1 | unmapped | TBD | Eval | 无 UI（后台能力） | 三题材 + 长线 | — | M2 |
| QUALITY-007 | 作者反馈记录 | V1 | unmapped | TBD | Feedback | writing | 接受/拒绝/改写 | — | M2 |
| QUALITY-008 | 人物声线/风格漂移检查 | V1 | unmapped | TBD | Style/Characters | writing | 卷级检查 | — | M2 |
| QUALITY-009 | 真实读者反馈 | 后续 | unmapped | TBD | ReaderFeedback | 无 UI（后台能力） | 后续 | — | M2 |
| CHANGE-001 | 修改请求/原因/差异/来源 | V1 | unmapped | TBD | Changes | changes | 请求 E2E | — | M2 |
| CHANGE-002 | 影响分析/六项检查 | V1 | unmapped | TBD | Changes | changes | 冲突分类 | — | M2 |
| CHANGE-003 | 应用/撤销修改 | V1 | unmapped | TBD | Changes/Canon | changes | 应用 E2E | — | M2 |
| CHANGE-004 | 任意版本点拉平行版本 | V1 | unmapped | TBD | Branches | changes | 独立正史 | — | M2 |
| CHANGE-005 | 正文/事实/设定/大纲/伏笔比较 | V1 | unmapped | TBD | Branches | changes | 逐对象差异 | — | M2 |
| CHANGE-006 | 逐对象摘取/合并 | V1 | unmapped | TBD | Branches/Canon | changes | 冲突确认 | — | M2 |
| CHANGE-007 | 高风险合并门禁 | V1 | unmapped | TBD | Gates | changes | 不可绕过 | — | M2 |
| CHANGE-008 | 回滚新版本/审计 | V1 | unmapped | TBD | Versions/Audit | changes | 历史保留 | — | M2 |
| CHANGE-009 | 全局当前分支/分支切换 | V1 | unmapped | TBD | Branches | shell/changes | 数据一致 | — | M2 |
| IO-001 | TXT/Markdown/DOCX 解析/切分/合并/拆分 | V1 | unmapped | TBD | Import | new-project/import | 文件矩阵 | — | M2 |
| IO-002 | 可选设定提取/候选/冲突/报告 | V1 | unmapped | TBD | Import/Canon | new-project (导入视图) | 报告 E2E | — | M2 |
| IO-003 | 导入后台任务/断点/进度 | V1 | unmapped | TBD | Jobs/Import | new-project (导入视图) | 千万字夹具 | — | M2 |
| IO-004 | 导出格式/范围/历史/下载/过期 | V1 | unmapped | TBD | Exports/Storage | export-publish | 全格式 E2E | — | M2 |
| IO-005 | 发布检查/预览/文案/标签 | V1 | unmapped | TBD | Publish | export-publish | 检查 + 预览 | — | M2 |
| IO-006 | 账号完整导出 | V1 | unmapped | TBD | Users/Export | account-settings | 包内容校验 | — | M2 |
| IO-007 | 备份/恢复/孤儿清理 | V1 | unmapped | TBD | Ops/Storage | 无 UI（后台能力） | 恢复演练 | — | M2 |
| SEARCH-001 | 跨作品/作品内全局搜索 | V1 | unmapped | TBD | Search | 全局壳层 | 中文检索 | — | M2 |
| SEARCH-002 | 全文索引/更新/重建 | V1 | unmapped | TBD | Search/Index | 无 UI（后台能力） | 提交后更新 | — | M2 |
| NOTIFY-001 | 站内通知/审核提醒/已读 | V1 | unmapped | TBD | Notifications | 全局壳层 | 任务通知 | — | M2 |
| SEC-001 | BYOK 加密/掩码/白名单/SSRF 防护 | V1 | unmapped | TBD | Security/ModelConfigs | account-settings | 安全 E2E | — | M3 |
| SEC-002 | RLS/租户隔离 | V1 | unmapped | TBD | Database/RLS | 无 UI（后台能力） | 跨用户测试 | — | M3 |
| SEC-003 | 日志脱敏/追踪默认关闭 | V1 | unmapped | TBD | Observability | 无 UI（后台能力） | 日志检查 | — | M3 |
| SEC-004 | 删除/备份过期/孤儿数据清理 | V1 | unmapped | TBD | Jobs/Storage | account-settings | 删除 SLA | — | M3 |
| SEC-005 | 内容安全/AI 标识/申诉 | V1 | unmapped | TBD | Moderation | legal/export-publish | 内容治理 | — | M3 |
| SEC-006 | 限流/审计/无管理员越权 | V1 | unmapped | TBD | Security/Audit | auth | 安全回归 | — | M3 |
| UI-001 | 页面/动作/API/状态矩阵 | V1 | unmapped | TBD | — | all | 矩阵完整 | — | M0–M3 |
| UI-002 | 设计令牌/组件清单 | V1 | unmapped | TBD | — | all | 组件对照 | — | M0–M3 |
| UI-003 | 7 栏/3 题材/统一状态枚举 | V1 | unmapped | TBD | — | settings/new-project | 信息架构 | — | M0–M3 |
| UI-004 | 逐页 loading/empty/error/disabled/permission/partial/long | V1 | unmapped | TBD | — | all | 状态矩阵 | — | M0–M3 |
| UI-005 | 1440/1180/900/390 响应式 | V1 | unmapped | TBD | — | all | Playwright 截图 | — | M0–M3 |
| UI-006 | Playwright 结构/截图基线 | V1 | unmapped | TBD | — | all | CI 门禁 | — | M0–M3 |
| UI-007 | Agent UX：本章参考/来源/冲突/修订/成本/失败/确认 | V1 | unmapped | TBD | — | writing/batch/changes | 页面验收 | — | M0–M3 |
| UI-008 | 导入报告/黄金三章/分支比较页面 | V1 | unmapped | TBD | — | import/outline/changes | 页面验收 | — | M0–M3 |
| UI-009 | 作者语言/无内部术语/prototype_only 登记 | V1 | unmapped | TBD | — | all | 术语扫描 | — | M0–M3 |
| OPS-001 | 健康检查/局域网与云部署 | V1 | unmapped | TBD | Ops/Deploy | 无 UI（后台能力） | 部署 smoke | — | M3 |
| OPS-002 | 备份/恢复演练 | V1 | unmapped | TBD | Ops/Backup | 无 UI（后台能力） | RPO/RTO | — | M3 |
| OPS-003 | 监控/日志/成本告警 | V1 | unmapped | TBD | Observability | 无 UI（后台能力） | 告警演练 | — | M3 |
| EVAL-001 | 三题材 + 长线基准集 | V1 | unmapped | TBD | Eval | 无 UI（后台能力） | 固定数据集 | — | M3 |
| EVAL-002 | 评分 rubric/阈值/回归 | V1 | unmapped | TBD | Eval | 无 UI（后台能力） | 发布门禁 | — | M3 |
| EVAL-003 | 真实 DeepSeek smoke | V1 | unmapped | TBD | Eval/AI | 无 UI（后台能力） | 连接与质量 | — | M3 |
| EVAL-004 | Prompt/模型灰度与回滚 | V1 | unmapped | TBD | Eval/Agents | 无 UI（后台能力） | 版本治理 | — | M3 |

## 强制规则

- 每张 ticket 必须引用至少一个能力 ID；每个 V1 能力必须有主 ticket。
- `implemented` 不能关闭 ticket；必须到 `verified`。
- 生产路径禁止 mock、固定 JSON、空下载、假连接测试和 toast 代替动作。
- 临时 stub 必须登记 owner、替换 ticket 和到期里程碑。
- 发布门禁要求所有 V1 能力达到 `verified` 或经批准 `deferred`，且 deferred 不进入发布承诺。
