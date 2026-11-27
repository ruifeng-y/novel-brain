# 故事蓝图自动生成规格

> Status: product behavior confirmed on 2026-11-27; implementation not started.
>
> Product decision source: Issue discussion recorded in this branch and accepted ADR 0029.
>
> Scale boundary: `scaleTarget` and the size table below define the bounded opening blueprint baseline from accepted ADR 0030, not the final full-book capacity from ADR 0010.
>
> Delivery gate: the blueprint review page requires a signed prototype, UI contract row and Production Golden before its production UI can merge.

## 1. Problem

当前“一句话想法”只创建作品、主创作线和空故事圣经。作者进入总览后得到的是一组空页面，必须逐页手工发起故事圣经、设定和大纲生成。这个行为与“把一个想法，长成一本书”的入口承诺不符，也不能为新作者提供可审阅的首版创作基线。

现有能力可以复用：

- 故事圣经已有九卡、提案、编辑、锁定、版本和世界铁律。
- 设定中心已有结构化世界规则、人物、势力、地图、力量体系、金手指、物品和时间线。
- 大纲已有全书/卷/幕/章/场景五层结构、卷契约、章纲和场景卡。
- `jobs`、`job_checkpoints`、BullMQ 和站内通知已有持久任务与恢复基础。

缺少的是把三者串成一次可恢复、受预算约束、必须由作者确认的开书体验。

## 2. Goal

作者输入一句话想法并创建作品后，系统自动在后台起草一份“故事蓝图”，包含：

1. 九卡故事圣经；
2. 与题材包匹配的核心设定；
3. 全书/分卷路线与首轮章纲、场景卡的初始大纲基线。

作者可以审阅、编辑、处理缺项与冲突，并明确确认。确认前，任何草稿都不能作为已确认设定参与正文生成；确认后，故事圣经和核心设定锁定，初始大纲成为作品基线，但不生成正文。

## 3. Non-goals

- 不在创建时生成第一章或其他章节正文。
- 不在开书时一次生成数百万字作品的全部章节和场景。
- 不自动确认蓝图，不自动把 AI 草案提交为已确认设定。
- 不改变空白作品、题材模板、设定导入和旧稿导入的既有创建语义。
- 不引入新的自由 Agent、微服务或独立数据库。
- 不以 Toast、静态假数据或前端本地状态冒充后台生成和持久化。

## 4. Domain Shape

### 4.1 故事蓝图

“故事蓝图”是面向作者的产品集合名，不是新的正史类型。它包含三类候选：

```ts
type BlueprintDraft = {
  storyBible: {
    cards: StoryBibleCard[]; // 固定九张
  };
  coreSettings: Array<{
    candidateId: string;
    type:
      | "world_rule"
      | "character"
      | "faction"
      | "map"
      | "power_system"
      | "golden_finger"
      | "item"
      | "timeline_event";
    name: string;
    aliases: string[];
    summary: string;
    description: string;
    tags: string[];
    data: Record<string, unknown>;
    required: boolean;
    source: "blueprint";
  }>;
  outline: {
    nodes: BlueprintOutlineNodeDraft[];
    volumeContracts: BlueprintVolumeContractDraft[];
    sceneCards: BlueprintSceneCardDraft[];
  };
};
```

确认前，`BlueprintDraft` 只保存在蓝图状态中。确认后，由确定性确认事务投影为正式故事圣经、设定条目、大纲节点、计划章节和场景卡。

### 4.2 生命周期

```text
queued
  -> running
  -> waiting_model_config
  -> budget_paused
  -> waiting_review
  -> confirmed

queued/running/waiting_model_config/budget_paused
  -> failed
  -> queued (retry)

queued/running/waiting_model_config/budget_paused/waiting_review
  -> cancelled
```

- `waiting_review` 表示生成与校验已结束，蓝图可编辑但仍未确认。
- `budget_paused`、`waiting_model_config`、`failed` 都不是完成状态。
- `confirmed` 只能由作者确认接口进入。
- `cancelled` 不删除已完成的候选和检查点，但不再继续调用模型。

### 4.3 持久状态

新增 `work_blueprints`，每个 `(work_id, branch_id)` 唯一：

```text
id
user_id
work_id
branch_id
job_id
status
version
input_hash
estimate
story_bible_draft
core_settings_draft
outline_draft
missing_fields
conflicts
acknowledgements
cost
confirmed_at
confirmed_by
created_at
updated_at
```

`estimate`、草稿、缺失项、冲突、确认声明和实际成本均为结构化 JSON，但正式故事圣经、设定和大纲仍投影到既有的一等表。不得用 `works.settings` JSONB 代替正式对象。

### 4.4 版本图

确认操作在同一事务中写入：

- 一个 `story_bible_version` 节点；
- 每个核心设定一个 `entity_version` 节点；
- 一个 `outline_version` 节点；
- 一个最终 `blueprint_version` 节点；
- `work_branches.head_node_id` 指向最终 `blueprint_version` 节点。

所有节点共享当前分支历史，不允许另建蓝图版本链。

## 5. Creation Behavior

### 5.1 Scope

自动蓝图只适用于 `WorkCreateRequest.mode = "idea"`。

- `blank` 继续创建空白作品，不自动生成。
- `template` 继续创建题材模板作品，不自动生成。
- `settings_import` 和 `manuscript_import` 继续走各自确认流程。

### 5.2 Estimate

`scaleTarget` 描述开书蓝图基线，不声明作品最终全书容量。最终容量仍按 ADR 0010 独立评估；本节的卷章数量只用于首轮候选生成、预算和审阅。

创建表单在提交前调用：

```text
GET /api/v1/blueprint-estimates?genre=<xianxia|history|urban>&scaleTarget=<short|medium|long|epic>&chapterLengthTarget=<number>
```

响应固定为：

```ts
type BlueprintEstimate = {
  ruleVersion: "blueprint-estimate-v1";
  planned: {
    volumes: number;
    chapters: number;
    scenes: number;
  };
  estimatedTokens: number;
  estimatedCostCny: number;
  defaultBudget: {
    maxTokens: number;
    maxCostCny: number;
  };
  assumptions: string[];
};
```

基础规模：

| scaleTarget | 卷 | 章 | 场景 | 基础 token |
| --- | ---: | ---: | ---: | ---: |
| short | 1 | 12 | 24 | 40,000 |
| medium | 3 | 36 | 72 | 100,000 |
| long | 5 | 60 | 120 | 180,000 |
| epic | 8 | 96 | 192 | 300,000 |

章节字数因子：

```text
chapterLengthFactor = clamp(1 + (chapterLengthTarget - 3000) / 10000, 0.8, 1.5)
estimatedTokens = round(baseTokens * chapterLengthFactor)
estimatedCostCny = estimatedTokens * currentModelRatePerToken
defaultMaxTokens = roundUpToThousand(estimatedTokens * 1.2)
defaultMaxCostCny = roundUpToFiveJiao(estimatedCostCny * 1.5)
```

模型价格不可用时，使用当前 `M0_COST_PER_TOKEN_CNY` 并在 `assumptions` 中说明。

### 5.3 Create Request

`idea` 创建请求增加可选预算覆盖：

```ts
blueprintBudget?: {
  maxTokens: number; // 20,000..600,000
  maxCostCny: number; // 0.10..10.00
};
```

服务端重新计算默认值并校验覆盖值。客户端不能扩大规模、改变模型价格或绕过服务端上限。

### 5.4 Redirect

- `POST /api/v1/works` 成功返回后，`idea` 模式进入 `/workspace/{workId}/blueprint`。
- 若后台任务已完成，同一 review 页直接显示候选。
- 若任务等待模型配置、预算或失败，显示对应恢复动作。
- 确认成功后进入 `/workspace/{workId}/overview`。

## 6. Generation Contract

### 6.1 Worker Job

新增 job type：

```text
generate_blueprint
```

固定步骤：

```text
prepare
story_bible
core_settings
outline
validate
await_review
```

每个步骤完成后写入 job 输出和 checkpoint。重试从检查点继续，不重复已成功模型调用。

### 6.2 Context

Worker 输入只包含：

- 作品标题、笔名、题材、规模、章节字数目标；
- 作者的一句话想法；
- 题材包的字段、规则、UI hints、生成指南和禁用元素；
- 当前模型配置的模型名、context window 和价格；
- 预算上限和检查点。

不得把其他作品的 Prompt、正文、私密上下文或模型 Key 写入任务 payload、日志或通知。

### 6.3 Story Bible

- 必须生成九卡，key 固定。
- `worldLaws` 至少三条结构化规则，名称唯一。
- 禁止使用题材包 `forbiddenElements`。
- 输出必须是结构化解码结果，不接受先写自由文本再猜测 JSON。

### 6.4 Core Settings

每个题材至少生成：

- 3 条 `world_rule`；
- 1 个主角 `character`；
- 1 个核心 `faction`；
- 1 个 `map`；
- 1 个 `power_system`；
- 与核心冲突直接相关的 1 至 3 个 `item`；
- 1 条起点 `timeline_event`。

仙侠额外要求 1 个 `golden_finger`。历史与都市可把金手指对应项标记为不适用。

题材包 `fieldSchema` 中标记必填的字段全部进入蓝图必填清单。作者确认时必须满足以下之一：

- 候选提供了有效值；
- 作者明确标记 `not_applicable` 并填写非空理由。

### 6.5 Initial Outline

- 1 个全书根节点；
- 按 5.2 表格生成卷节点；
- 每卷 3 幕；
- 每卷生成表格规定的章节，章号从 1 连续递增；
- 每章生成至少 2 个场景卡；
- 每个卷有卷契约；
- 每个章有完整 `ChapterBrief`：目标、POV、地点、场景节拍和必用事实；
- 场景卡包含 POV、地点、故事时间、有序 beats 和信息释放；
- 前 12 章至少包含一个章末钩子和一个可追踪伏笔；
- 章节状态全部为 `planned`；
- 不创建 `chapter_versions`，不写正文。

### 6.6 Validation

`validate` 步骤必须 fail closed：

- 九卡数量或 key 错误；
- 世界规则少于三条或重名；
- 必填核心设定缺失；
- P0 冲突未解决；
- 大纲层级不合法、章号不连续、场景无节拍；
- 出现题材包禁用元素；
- JSON 解码失败；
- 输出超过 schema 长度限制。

普通缺失写入 `missing_fields`。P0 冲突写入 `conflicts` 并阻止确认。P1/P2 作为可审阅提醒保留，不伪装成 P0。

## 7. Budget and Recovery

每次模型调用前执行：

```text
projectedTokens = estimatedPromptTokens + maxOutputTokens
projectedCost = projectedTokens * currentModelRatePerToken
if actualTokens + projectedTokens > maxTokens
   or actualCost + projectedCost > maxCostCny
then pause(budget_paused)
```

暂停时：

- 保存当前阶段、检查点、已用成本和候选；
- 写入 `job_failed` 或 `blueprint_budget_paused` 通知；
- 不删除已完成候选；
- 不静默降级模型或缩短输出。

作者可调用：

```text
POST /works/{workId}/branches/{branchId}/blueprint/budget
```

请求：

```ts
{
  expectedVersion: number;
  maxTokens: number;
  maxCostCny: number;
}
```

新预算必须严格大于已用成本且不超过服务端绝对上限。成功后将任务重新入队，从检查点继续。

模型配置缺失时进入 `waiting_model_config`，不创建空候选，不消耗费用。

## 8. Review and Edit

### 8.1 Review API

```text
GET /api/v1/works/{workId}/branches/{branchId}/blueprint
PATCH /api/v1/works/{workId}/branches/{branchId}/blueprint/draft
POST /api/v1/works/{workId}/branches/{branchId}/blueprint/retry
POST /api/v1/works/{workId}/branches/{branchId}/blueprint/budget
POST /api/v1/works/{workId}/branches/{branchId}/blueprint/confirm
```

`GET` 返回：

- 状态、进度、当前步骤、预算、实际成本；
- 九卡故事圣经候选；
- 核心设定候选；
- 大纲节点、卷契约、章纲和场景卡候选；
- 必填缺失、可选缺失、P0/P1/P2 冲突；
- 允许动作；
- 作者确认所需的 `version`。

### 8.2 Draft Patch

作者可以在 `waiting_review` 编辑候选。`PATCH` 必须携带 `expectedVersion`，并使用 JSON Patch 风格的显式操作，不允许整包覆盖未审阅字段。

支持：

- 编辑九卡内容与世界规则；
- 编辑核心设定名称、摘要、描述和结构化 data；
- 编辑大纲节点标题、摘要、卷契约、章纲和场景卡；
- 删除非必填候选；
- 把必填字段标记为 `not_applicable` 并填写理由。

每次成功 patch 增加蓝图 version，不创建正式故事对象。

### 8.3 Review UI

新增页面：

```text
/workspace/[workId]/blueprint
```

页面状态：

- `running`
- `waiting_model_config`
- `budget_paused`
- `failed`
- `waiting_review`
- `confirmed`
- `cancelled`
- loading / empty / partial / long / conflict / disabled / read-only

页面必须同时呈现：

- 故事圣经九卡；
- 核心设定候选及必填字段状态；
- 全书/分卷路线、章纲和场景卡；
- 缺失项与冲突；
- 预算与成本；
- “确认蓝图”门禁。

UI 合同和原型签收完成前，本页生产实现不得合并。

## 9. Confirmation Transaction

`POST .../blueprint/confirm` 请求：

```ts
{
  expectedVersion: number;
  draftHash: string;
  acknowledgements: Array<{
    fieldKey: string;
    decision: "not_applicable";
    reason: string;
  }>;
  confirmed: true;
}
```

确认事务按以下顺序执行：

1. 行锁 `work_blueprints`，校验状态、version、draft hash 和作者身份。
2. 重新运行服务端校验；不信任客户端提交的 readiness。
3. 校验所有 P0 冲突已解决。
4. 校验所有必填字段有值或有效 `not_applicable`。
5. 写故事圣经、世界规则、核心设定、大纲、计划章节和场景卡。
6. 写版本节点并把分支 head 指向 `blueprint_version`。
7. 将故事圣经和核心设定标为 `locked`。
8. 将蓝图标为 `confirmed`，记录作者、时间、输入 hash 和确认声明。
9. 写通知与审计。

任一步失败回滚整个事务。重复相同请求按 idempotency key 返回同一确认结果；draft hash 或 version 改变返回 `409 VERSION_CONFLICT`。

确认后：

- `work.status` 可从 `draft` 进入 `preparing`，但不自动进入 `serializing`；
- 总览显示“蓝图已完成”；
- 主操作显示“开始写第一章”；
- 第一章正文为空，不自动触发生成任务。

## 10. Notifications

新增事件：

```text
blueprint_ready
blueprint_failed
blueprint_waiting_model_config
blueprint_budget_paused
```

通知 payload 只包含作者可读标题、摘要、目标 URL 和公开状态，不包含 Prompt、正文、模型 Key 或私密上下文。相同 job、事件和 checkpoint revision 去重。

## 11. Security and Observability

- 所有蓝图查询和变更按 `user_id + work_id + branch_id` 隔离并启用 RLS。
- 跨用户访问返回 `403 FORBIDDEN_TENANT_ACCESS`。
- 模型 Key 不进入蓝图表、Queue payload、普通日志或通知。
- 日志只允许 job id、阶段、状态、token、费用和错误码。
- 生成轨迹记录 Prompt 版本、模型、token、费用、checkpoint 和来源摘要，不记录明文 Key。
- 重试、预算调整、patch、确认和取消都写审计。

## 12. Acceptance

### 12.1 Contract and Unit

- 所有蓝图 schema 的合法/非法样例。
- 预算估算在不同题材、规模、章节字数下的确定性。
- P0 冲突阻止确认；必填缺失阻止确认；有效不适用声明允许确认。
- 状态机拒绝非法跳转。

### 12.2 API Integration

- `idea` 创建自动创建 job、蓝图和通知。
- 非 `idea` 模式不创建蓝图 job。
- 后台完成写入九卡、核心设定和完整初始大纲候选。
- 页面关闭后轮询仍能恢复进度。
- 预算暂停可提高预算并从检查点继续。
- 模型配置缺失进入等待状态。
- 确认前不产生正式故事圣经锁定、设定锁定、章节和大纲节点。
- 确认事务成功后所有正式对象和版本节点存在。
- 确认事务中途失败无部分写入。
- 跨租户读取/写入失败。
- 相同确认请求幂等，不同 draft hash 冲突。

### 12.3 Worker

- 每阶段 checkpoint 后可恢复。
- 已成功阶段不重复调用 provider。
- 预计超预算时在调用前暂停。
- Provider schema 错误、限流、超时和无模型配置进入预期状态。
- 模型身份、Key 和私密 Prompt 不进入日志。

### 12.4 Web and E2E

- 创建想法前显示估算和默认预算。
- 创建后跳转蓝图审阅页，后台进度真实回读。
- 四档视口 1440/1180/900/390 无重叠和横向溢出。
- 页面覆盖 running、waiting model config、budget paused、failed、review、confirmed 状态。
- 作者可编辑候选并看到缺失项和冲突。
- 未处理 P0 时确认按钮禁用。
- 必填项不适用时必须填写理由。
- 确认后进入总览，显示“蓝图已完成”和“开始写第一章”。
- 第一章正文为空，章节状态为 `planned`。
- 作者语言扫描和 prototype-only 泄漏扫描通过。

## 13. Ticket Decomposition

1. 蓝图 contracts、估算器、数据库状态与创建接线。
2. Worker 蓝图生成、预算、检查点、重试与通知。
3. 蓝图审阅、草稿编辑、校验与确认事务 API。
4. 蓝图审阅页原型、UI 合同、作者签收与四档 Golden。
5. 新建作品预算估算、审阅页、总览完成态和 Playwright。
6. 安全、恢复、租户隔离、文档与发布证据。

Ticket 4 blocks ticket 5's production UI merge. Tickets 1–3 may implement backend seams first. No ticket may claim the feature complete before human visual signoff, full E2E and all repository guardrails pass.
