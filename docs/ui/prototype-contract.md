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
| work-overview | `/workspace/[workId]/overview` | 继续写作、任务、最近修改、跨卷风格检查、卷末审计与签收 | loading/empty/error/partial/readonly/archived/long | 生成摘要/风格证据/卷审计证据 | parity-verified；7 个必需动作均通过真实 API 与持久化断言，正常态、长内容态、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| bible | `/workspace/[workId]/bible` | 编辑、AI 检查、补全、世界铁律、锁定、版本历史、锁定修改请求、解锁 | loading/empty/error/locked/proposal/partial/conflict/long | AI 提案/证据 | parity-verified；9 个必需动作均通过真实 API 与持久化断言，三题材、世界铁律、版本/锁定、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| settings | `/workspace/[workId]/settings` | 7 栏 CRUD、关系、地图、力量、时间线、题材包版本切换 | loading/empty/error/disabled/locked/proposal/long | 设定提案 | parity-verified；10 个必需动作均通过真实 API 与持久化断言，七栏 CRUD、关系、地图、力量、时间线与题材包切换、四档 Golden、作者视觉签收和正常 PR CI 均已通过 |
| outline | `/workspace/[workId]/outline` | 树/看板/张力曲线/账本、黄金三章；章节/场景规划张力（0–100） | loading/empty/error/locked/partial/long | 黄金三章候选 | production-built；五层大纲、卷契约、场景卡、账本、黄金三章和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| foreshadows | `/workspace/[workId]/foreshadows` | 新增/编辑/埋设/推进/回收/失败回收/放弃/延期/检查 | loading/empty/error/disabled/long | 逾期提醒 | production-built；完整动作、loading 状态和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| writing | `/workspace/[workId]/write` | 生成/续写/改写/检查/批准章节/确认事实/提交本章事实/版本 | loading/empty/error/disabled/partial/conflict/long | 本章参考/来源/淘汰/修订 diff/成本/检查点 | production-built；三段状态机、生成/修订/提交门禁和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| batch | `/workspace/[workId]/batch` | 开始/暂停/恢复/取消/重试/审核/报告 | loading/empty/error/partial/disabled/long/paused/failed | 失败断点/成本/审批 | production-built；暂停、失败、成本硬停、审核决策和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| changes | `/workspace/[workId]/changes` | 新建/分析/应用/撤销/分支/比较/合并 | loading/error/conflict/partial/disabled/stale-version | 逐对象比较/摘取 | production-built；请求/影响/应用、分支比较、高风险门禁和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| export-publish | `/workspace/[workId]/export` | 导出/下载/发布检查/预览/文案 | loading/empty/error/partial/expired/long | 任务报告 | production-built；导出、发布检查、预览、过期恢复、AI 标识和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| work-settings | `/workspace/[workId]/work-settings` | 封面/标签/状态/复制/归档/删除 | loading/error/disabled/permission/readonly/confirmation | 无 | production-built；复制、归档恢复、回收站、导出后删除和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| entity-detail | `/workspace/[workId]/settings?column=<column>&entityId=<entityId>` 独立整页 | 档案/关系/认知/引用/历史 | loading/error/disabled/locked/proposal/long | 来源引用 | production-built；七类档案、题材化层级文案、引用/历史和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
| account-settings | `/workspace/settings`、`/workspace/settings/account` | 资料/笔名/会话/模型/导出/注销 | loading/error/invalid-key/disabled/partial/rate-limit | 无 | production-built；常规态、Key 错误态、导出/注销恢复和四档 Golden 已实现，等待动作审计和最终正常 PR CI |
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
- 响应式证据：390/900/1180/1440 已覆盖 18 页，见 `prototype/screens/v1-baseline/README.md`。
- 门禁修正：结构性冲突不可直接应用；锁定档案的编辑、别名和 AI 提案都走修改请求；黄金三章六维未达标不可锁定；导入冲突未裁决不可进入总览；作品/账号删除需先导出。
- 上下文修正：侧栏显示当前分支；导入改为大文件分块；批量页加入父卷章任务说明；修改页加入单一版本图和选择性摘取说明。
- 逐页状态：已从全局遮罩改为页面内 `page-state-panel`，每页有独立状态标题、文案和动作。
- Playwright：49 项断言通过，覆盖 18 页 × 4 档响应式、18 页专属状态文案、门禁按钮、设定导入、事实提交和全站内部术语扫描。
- 视觉证据：Playwright Chromium 生成 18 页 × 4 档共 72 张截图；CI 工作流已建立。
- V1 基线已签收：见 `docs/ui/v1-prototype-signoff.md`。
- 完整组件变体和真实后端数据属于实现阶段验证，不回退原型基线。
