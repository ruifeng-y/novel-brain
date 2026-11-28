# V1 Prototype Contract

> 原型是 UI 验收基线。本文定义页面/动作/状态/API 对应关系、组件和签收规则；不是 spec。
>
> 逐页生产一致性追踪见 `docs/ui/v1-ui-parity-matrix.md`。

## 1. 页面矩阵

| 页面 | 生产路由 | 关键动作 | 必备状态 | Agent UX | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| auth | `/login`、`/register`、`/forgot-password`、`/reset-password` | 登录、注册、验证码、找回 | loading/error/disabled/permission/rate-limit/session-expired | 无 | parity-verified；七个必需动作、持久化会话、四档 Golden、错误与权限状态和正常 PR Production CI 均已通过 |
| dashboard | `/workspace` | 搜索、状态/题材/最近编辑/字数筛选、新建、归档、恢复、删除 | loading/empty/error/disabled/long | 无 | parity-verified；7 个动作、完整 §5.8 筛选、主线指标、四档 Golden、作者视觉签收和最终正常 PR CI 均已通过 |
| new-project | `/workspace/new-project` | 想法/空白/三题材模板/设定导入/旧稿导入、蓝图、创建 | loading/error/partial/disabled/long/conflict | 导入报告 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，三题材模板、导入双模式、冲突裁决、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| blueprint | `/workspace/[workId]/blueprint` | 审阅候选、调整预算、重试、取消、标记必填项不适用、处理冲突、确认蓝图 | running/waiting_model_config/budget_paused/failed/waiting_review/confirmed/cancelled/loading/empty/partial/long/conflict/disabled/readonly | 候选来源/缺失项/冲突证据/成本/检查点/确认门禁 | 原型候选待作者四档视觉签收；`#291` 未完成、`#292` production-pending，签收前禁止生产实现或合并 |
| work-overview | `/workspace/[workId]/overview` | 继续写作、任务、最近修改、跨卷风格检查、卷末审计与签收 | loading/empty/error/partial/readonly/archived/long | 生成摘要/风格证据/卷审计证据 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，正常态、长内容态、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| bible | `/workspace/[workId]/bible` | 编辑、AI 检查、补全、世界铁律、锁定、版本历史、锁定修改请求、解锁 | loading/empty/error/locked/proposal/partial/conflict/long | AI 提案/证据 | parity-verified；9 个必需动作均通过真实 API 与持久化断言，三题材、世界铁律、版本/锁定、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| settings | `/workspace/[workId]/settings` | 7 栏 CRUD、关系、地图、力量、时间线、题材包版本切换 | loading/empty/error/disabled/locked/proposal/long | 设定提案 | parity-verified；10 个必需动作均通过真实 API 与持久化断言，七栏 CRUD、关系、地图、力量、时间线与题材包切换、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| outline | `/workspace/[workId]/outline` | 树/看板/张力曲线/账本、黄金三章；章节/场景规划张力（0–100） | loading/empty/error/locked/partial/long | 黄金三章候选 | parity-verified；11 个必需动作均通过真实 API 与持久化断言，五层大纲、卷契约、场景卡、账本、黄金三章、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| foreshadows | `/workspace/[workId]/foreshadows` | 新增/编辑/埋设/推进/回收/失败回收/放弃/延期/检查 | loading/empty/error/disabled/long | 逾期提醒 | parity-verified；9 个必需动作均通过真实 API 与持久化断言，检查结果绑定持久化风险记录，四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| writing | `/workspace/[workId]/write` | 生成/续写/改写/检查/批准章节/确认事实/提交本章事实/版本 | loading/empty/error/disabled/partial/conflict/long | 本章参考/来源/淘汰/修订 diff/成本/检查点 | parity-verified；18 个必需动作均通过真实 API 与持久化断言，章节创建、append-only 旧版恢复、三段状态机、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| batch | `/workspace/[workId]/batch` | 开始/暂停/恢复/取消/重试/审核/报告 | loading/empty/error/partial/disabled/long/paused/failed | 失败断点/成本/审批 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，任务发现与生命周期控制、按需成本报告、审核决策、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| changes | `/workspace/[workId]/changes` | 新建/分析/应用/撤销/分支/比较/合并 | loading/error/conflict/partial/disabled/stale-version | 逐对象比较/摘取 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，修改生命周期、回滚、平行版本、逐对象摘取、高风险门禁、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| export-publish | `/workspace/[workId]/export` | 导出/下载/发布检查/预览/文案 | loading/empty/error/partial/expired/long | 任务报告 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，下载响应头/哈希、固定预览、文案复制、过期清理、申诉和重新导出均已回读，四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| work-settings | `/workspace/[workId]/work-settings` | 封面/标签/状态/复制/归档/删除 | loading/error/disabled/permission/readonly/confirmation | 无 | parity-verified；9 个必需动作均通过真实 API 与持久化断言，保守复制、归档恢复、回收站、导出后永久删除、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| entity-detail | `/workspace/[workId]/settings?column=<column>&entityId=<entityId>` 独立整页 | 档案/关系/认知/引用/历史 | loading/error/disabled/locked/proposal/long | 来源引用 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，认知有效期、正文/章纲/POV/伏笔/故事圣经/事实反向引用和版本历史均已回读，四档 Golden 与正常 PR CI 通过 |
| account-settings | `/workspace/settings`、`/workspace/settings/account` | 资料/笔名/会话/模型/导出/注销 | loading/error/invalid-key/disabled/partial/rate-limit | 无 | parity-verified；13 个必需动作均通过真实 API 与持久化断言，模型/资料/笔名/会话、导出秘密排除、注销恢复和四档 Golden 均已通过正常 PR CI |
| help | `/help` | 快捷键/术语/FAQ | static/empty/error | 无 | parity-verified；FAQ、空搜索、四档 Golden、真实路由错误态/重试恢复和正常 PR Production CI 均已通过 |
| legal | `/legal/*` | 协议/隐私/AI 标识 | static/error | 无 | parity-verified；隐私、条款、AI 标识和四档 Golden 已签收 |
| states | 无生产路由（prototype-only） | 全局状态演示 | normal/empty/loading/error/locked/readonly/conflict | 无 | 演示页，缺 disabled/permission/partial/long |

## 2. 组件清单

| 组件 | 原型来源 | 生产约束 |
| --- | --- | --- |
| 壳层/侧栏 | `.sidebar`、`.app-shell` | 固定品牌、导航分组、当前作品/分支、用户卡 |
| 顶栏/面包屑 | `.topbar`、`.crumbs` | 搜索、通知、账号菜单、当前作品/分支 |
| 站内通知抽屉 | `.notification-drawer`、`.notification-item`、`.notification-foot` | 顶栏铃铛打开右侧抽屉；未读计数、加载/空/错误、单条已读、全部已读 |
| 按钮/图标按钮 | `.btn`、`.icon-btn` | primary/ghost/danger/disabled/loading |
| 面板/卡片 | `.panel`、`.project-card`、`.stat-card` | 统一边框、圆角、间距、空态 |
| 表格/列表 | `.fact-table`、`.chapter-list`、`.review-item` | 长列表分页/虚拟化、空态、错误态 |
| 标签/徽章 | `.badge`、`.status-pill`、`.state-chip` | 状态色和文案唯一枚举 |
| Tab/分段 | `.note-tab`、`.segmented`、`.seg` | 选中态、键盘、ARIA |
| 弹窗/抽屉 | `.modal`、`.drawer` | 焦点陷阱、Esc、焦点返回、危险确认 |
| 表单 | `.field`、`.select`、`.check-row` | 内联错误、禁用、帮助文案 |
| 质量报告 | `.quality-dimensions` | 六维、证据、趋势 |
| 版本图 | `.version-graph`、`.branch-tree` | 版本节点、父子关系、分支/合并 |
| 对比 | `.compare-box` | 正文/事实/设定/大纲/伏笔分别比较 |

## 3. 设计令牌

当前可用令牌来自 `prototype/styles.css`：

- 颜色：`--ink`、`--ink-2`、`--ink-3`、`--muted`、`--line`、`--paper`、`--paper-2`、`--cinnabar`、`--jade`、`--gold`、`--blue` 及对应 soft 色。
- 字体：`Microsoft YaHei`、`PingFang SC`、`Noto Sans SC`；标题可用宋体/衬线。
- 圆角：`--radius: 8px`，小控件 6px，胶囊 999px。
- 阴影：`--shadow-sm`、`--shadow-md`。
- 侧栏宽度：`--sidebar: 248px`。
- 断点：1440 / 1180 / 900 / 390。

| 类别 | 令牌 | 用途 |
| --- | --- | --- |
| 字号 | `12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 30 / 36px` | 说明、元信息、正文、强调、小标题、卡片标题、区块标题、页面标题、展示标题 |
| 行高 | `1.2 / 1.4 / 1.5 / 1.6 / 1.8` | 展示标题、紧凑标题、控件、正文、长文阅读 |
| 间距 | `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40px` | 图标与文字、字段、卡片内边距、区块间距、页面间距 |
| 层级 | `1 / 30 / 40 / 75 / 90 / 100 / 110 / 120` | 内容、局部浮层、侧栏、顶栏、下拉、抽屉、弹窗、Toast |
| 状态色 | `jade` 成功、`gold` 待确认、`blue` 信息、`cinnabar` 危险、`muted` 禁用 | 状态徽章、提示、风险与进度 |
| 控件尺寸 | 按钮 `32 / 36 / 40px`；输入 `38px`；图标 `18px` | 表单、工具栏、主操作 |
| 圆角 | `6px / 8px / 999px` | 小控件、面板、胶囊 |
| 侧栏 | `248px`；900px 以下收起 | 全局导航 |

实现时新增字号或状态色必须先更新本表，不能在页面里临时造一套。

## 4. `prototype_only` 清单

以下控件只用于演示，禁止进入生产 UI：

- 顶栏“演示模式”。
- 题材差异演示。
- 全局“界面状态”演示页。
- 演示数据重置/状态切换按钮。
- 故事蓝图审阅页顶部的“原型场景”切换器；只用于四档状态签收，不得进入生产 UI。
- 故事蓝图确认后用于展示“蓝图已完成 / 开始写第一章”过渡的作品总览预览；仅用于 #291 原型签收，#292/#293 生产实现仍按原 ticket 边界执行。
- 仅为展示长内容而写死的示例卡片。

## 5. 签收规则

- 每个 UI ticket 必须引用本矩阵的一行。
- 每个 UI ticket 必须同步填写 `docs/ui/v1-ui-parity-matrix.md` 的 ticket、parity test 和生产 golden 列。
- 每个页面必须实现本页必备状态，不能只做正常态。
- 每个可见控件必须映射到真实动作，或标记为 `prototype_only`。
- 每个页面至少提交 1440/1180/900/390 的结构或截图证据。
- Agent UX 页面必须展示本章参考、来源引用、冲突证据、修订差异、成本/失败断点或人工确认点。
- 原型变更先更新本矩阵和原型，再由作者签收，之后才允许进入实现。

## 6. 当前结论

- 硬冲突已修正：7 栏、3 题材、1000 万字、100 章/卷、高风险门禁、复制默认、章节批准与事实提交拆分。
- 增量已加入：导入报告、黄金三章候选、分支逐对象比较、写作台本章参考/来源/淘汰/修订差异/成本/检查点。
- 响应式证据：390/900/1180/1440 已覆盖 19 页，其中 18 页为 V1 已签收基线、1 页为 post-V1 故事蓝图候选，见 `prototype/screens/v1-baseline/README.md`。
- 门禁修正：结构性冲突不可直接应用；锁定档案的编辑、别名和 AI 提案都走修改请求；黄金三章六维未达标不可锁定；导入冲突未裁决不可进入总览；作品/账号删除需先导出。
- 上下文修正：侧栏显示当前分支；导入改为大文件分块；批量页加入父卷章任务说明；修改页加入单一版本图和选择性摘取说明。
- 逐页状态：已从全局遮罩改为页面内 `page-state-panel`，每页有独立状态标题、文案和动作。
- Playwright：74 个测试通过，覆盖 19 页 × 4 档响应式、19 页专属状态文案、蓝图生命周期与确认门禁、设定导入、事实提交和全站内部术语扫描。
- 视觉证据：Playwright Chromium 已生成 V1 基线 18 页 × 4 档共 72 张截图；post-V1 `blueprint` 候选另有 4 张，位于 `prototype/screens/v1-baseline/blueprint-{390,900,1180,1440}.png`，尚未获得作者签收。
- V1 基线已签收：见 `docs/ui/v1-prototype-signoff.md`。
- 2026-11-28：`#291` 的故事蓝图审阅页已形成四档原型候选，覆盖生成中、等待模型配置、预算暂停、失败、待确认、已确认、已取消和冲突；人工四档视觉签收仍未完成，`#292` 继续阻塞。
- 完整组件变体和真实后端数据属于实现阶段验证，不回退原型基线。
- 2026-11-24：#238 已把 UI-001..UI-009 收口到 `docs/implementation/m3-238-ui-capability-evidence.json`；17 个生产页仍以本契约和 parity matrix 为事实源。
