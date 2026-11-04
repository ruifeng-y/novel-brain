# V1 UI Parity Matrix

> 状态：编码前生效
> 权威来源：`docs/ui/prototype-contract.md`、`docs/ui/v1-prototype-signoff.md`
> 目标：让“最终 Web 页面与原型一致”成为可追踪、可测试、可阻断合并的门禁。

## 1. 状态定义

| 状态 | 含义 |
| --- | --- |
| `prototype-signed` | 原型已签收，有页面、动作、状态和四档截图 |
| `production-pending` | 生产页面尚未实现或未提交 parity 证据 |
| `production-built` | 页面已实现，但尚未完成完整 parity 验收 |
| `parity-verified` | 路由、动作、状态、响应式、视觉和作者语言全部通过 |
| `deviation-approved` | 经作者签收的明确偏离，记录原因、范围和替代基线 |
| `prototype-only` | 只用于演示，不进入生产 |
| `later-M1/M2/M3` | 当前里程碑不实现，但保留原型基线 |

只有 `parity-verified` 或 `deviation-approved` 的页面可以进入 V1 发布验收。

## 2. 全局规则

- 每个 UI ticket 必须引用本矩阵的一行，并列出该行的页面 ID 和能力 ID。
- 每个页面的生产路由必须与原型页面语义一致，不能拆成多个无映射页面或把多个页面塞进一个无结构页面。
- 页面必须实现该行要求的状态；不能只做正常态。
- 四档截图固定为 1440 / 1180 / 900 / 390，固定测试数据和固定 Chromium 字体环境。
- 生产页面首次通过作者对照后，生成生产 golden screenshot；之后 CI 视觉 diff 不允许无审批漂移。
- 作者界面不允许出现 Agent、Canon、Context Pack、P0–P4、正史等内部术语。
- 任何页面结构、动作、门禁或状态变更，先更新原型、`prototype-contract.md`、本矩阵和签收记录，再改生产代码。
- 全局 UI 能力 `UI-001`–`UI-009` 适用于所有页面；下表只列页面专有能力。

## 3. 页面一致性台账

原型截图统一位于 `prototype/screens/v1-baseline/`，每页固定四张：

```text
<page>-390.png
<page>-900.png
<page>-1180.png
<page>-1440.png
```

| 页面 ID | 原型 hash | 生产路由 | 里程碑 | 页面专有能力 | 必备状态 | 原型证据 | UI ticket | Parity test | 生产 golden | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auth | `#auth` | `/login`、`/register`、`/forgot-password`、`/reset-password` | M0 | ACCT-001、ACCT-002、ACCT-009 | loading / error / disabled / permission / rate-limit / session-expired | `auth-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| dashboard | `#dashboard` | `/workspace` | M0 | WORK-004、WORK-006、WORK-009 | loading / empty / error / disabled / long | `dashboard-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| new-project | `#new-project` | `/workspace/new-project` | M0 | WORK-001、WORK-002、WORK-003、ONBOARD-001、ONBOARD-003 | loading / error / partial / disabled / long | `new-project-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| work-overview | `#work-overview` | `/workspace/[workId]/overview` | M0 partial → M1 full | WORK-005、WORK-009 | loading / empty / error / partial / readonly / archived / long | `work-overview-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| bible | `#bible` | `/workspace/[workId]/bible` | M0 | ONBOARD-001、ONBOARD-002、ONBOARD-004、ONBOARD-005 | loading / empty / error / locked / proposal / partial / long | `bible-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| settings | `#settings` | `/workspace/[workId]/settings` | M0 partial → M1 full | SET-001、SET-002、SET-003、SET-004、SET-005、SET-006、SET-007、SET-008、SET-009、SET-010、SET-011、SET-012、ONBOARD-003、ONBOARD-005 | loading / empty / error / disabled / locked / proposal / long | `settings-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| outline | `#outline` | `/workspace/[workId]/outline` | M0 partial → M1 full | PLAN-001、PLAN-002、PLAN-003、PLAN-004、PLAN-005、PLAN-006、PLAN-007、GEN-009 | loading / empty / error / locked / partial | `outline-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| foreshadows | `#foreshadows` | `/workspace/[workId]/foreshadows` | M1 | PLAN-004 | loading / empty / error / disabled / long | `foreshadows-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M1 |
| writing | `#writing` | `/workspace/[workId]/write` | M0 partial → M1 full | GEN-001、GEN-002、GEN-003、GEN-004、GEN-005、GEN-006、AGENT-004、AGENT-005、AGENT-010、AGENT-011、QUALITY-001、QUALITY-002、QUALITY-003 | loading / empty / error / disabled / partial / conflict / long | `writing-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| batch | `#batch` | `/workspace/[workId]/batch` | M2 | GEN-007、GEN-008、GEN-010、GEN-011、QUALITY-004、QUALITY-005 | loading / empty / error / partial / disabled / long | `batch-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M2 |
| changes | `#changes` | `/workspace/[workId]/changes` | M2 | CHANGE-001、CHANGE-002、CHANGE-003、CHANGE-004、CHANGE-005、CHANGE-006、CHANGE-007、CHANGE-008、CHANGE-009 | loading / error / conflict / partial / disabled | `changes-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M2 |
| export-publish | `#export-publish` | `/workspace/[workId]/export` | M3 | IO-004、IO-005 | loading / empty / error / partial / expired / long | `export-publish-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M3 |
| work-settings | `#work-settings` | `/workspace/[workId]/work-settings` | M1 | WORK-006、WORK-007、WORK-008 | loading / error / disabled / permission / readonly | `work-settings-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M1 |
| entity-detail | `#entity-detail` | `/workspace/[workId]/settings` 内嵌 | M1 | SET-002、SET-003、SET-004、SET-005、SET-006、SET-007、SET-008、SET-009、SET-010、SET-012 | loading / empty / error / disabled / locked / proposal / long | `entity-detail-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M1 |
| account-settings | `#account-settings` | `/workspace/settings`、`/workspace/settings/account` | M0 partial → M1 full | ACCT-003、ACCT-004、ACCT-005、ACCT-006、ACCT-007、ACCT-008、ACCT-009 | loading / error / disabled / permission / partial / rate-limit | `account-settings-{390,900,1180,1440}.png` | TBD | TBD | TBD | production-pending |
| help | `#help` | `/help` | M3 | UI-009 | static / empty / error | `help-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M3 |
| legal | `#legal` | `/legal/*` | M3 | SEC-005 | static / error | `legal-{390,900,1180,1440}.png` | TBD | TBD | TBD | later-M3 |
| states | `#states` | 不进入生产 | prototype-only | UI-004、UI-005、UI-006 | normal / empty / loading / error / disabled / permission / partial / long / locked / readonly / conflict | `states-{390,900,1180,1440}.png` | — | — | — | prototype-only |

## 4. 页面级验收清单

页面从 `production-built` 进入 `parity-verified` 前，必须同时满足：

1. 路由存在，且页面根节点、壳层、导航和面包屑符合原型。
2. 所有主操作已接真实 API 或 Worker，不存在纯 Toast 假动作。
3. 页面所有适用状态都有可见出口。
4. 1440 / 1180 / 900 / 390 无横向溢出，布局断点符合原型。
5. Playwright 通过关键动作、门禁、状态和角色/名称断言。
6. 生产 golden screenshot 已由作者对照原型签收。
7. 作者语言扫描通过。
8. ticket 引用本矩阵行和至少一个能力 ID。
9. 故意偏离已有 `deviation-approved` 记录。

## 5. 视觉基线规则

- 原型截图是设计基线，不是生产 HTML 的直接像素复用目标。
- 首次生产实现由作者对照原型签收后，生产 Chromium 截图成为 golden baseline。
- 后续 CI 使用固定 viewport、固定字体、固定 fixture 和明确 diff 阈值。
- 允许浏览器字体渲染差异，不允许布局、信息顺序、主操作位置、门禁或状态文案漂移。
- 视觉 diff 失败时，修复页面；确需偏离时更新原型和本矩阵并重新签收。

## 6. 与 `/to-tickets` 的关系

- 每个 UI ticket 必须填本矩阵的 `UI ticket` 列和 `Parity test` 列。
- 一个 ticket 可以覆盖多个相邻页面，但不能让任何页面没有归属。
- ticket 完成后把当前状态更新为 `production-built`；全部证据通过后改为 `parity-verified`。
- M1–M3 页面现在保持 `later-M1/M2/M3`，不代表可以跳过本矩阵。
