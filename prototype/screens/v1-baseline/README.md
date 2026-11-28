# V1 Baseline Screenshots

生成方式：Playwright Chromium headless，读取相对路径
`prototype/index.html#<page>`，执行 `pnpm run capture:screens`。

## 覆盖

| 页面 | 390 | 900 | 1180 |
| --- | --- | --- | --- |
| auth | ✅ | ✅ | ✅ |
| dashboard | ✅ | ✅ | ✅ |
| new-project | ✅ | ✅ | ✅ |
| blueprint（post-V1 候选，待签收） | ✅ | ✅ | ✅ |
| work-overview | ✅ | ✅ | ✅ |
| bible | ✅ | ✅ | ✅ |
| settings | ✅ | ✅ | ✅ |
| outline | ✅ | ✅ | ✅ |
| foreshadows | ✅ | ✅ | ✅ |
| writing | ✅ | ✅ | ✅ |
| batch | ✅ | ✅ | ✅ |
| changes | ✅ | ✅ | ✅ |
| export-publish | ✅ | ✅ | ✅ |
| work-settings | ✅ | ✅ | ✅ |
| entity-detail | ✅ | ✅ | ✅ |
| account-settings | ✅ | ✅ | ✅ |
| help | ✅ | ✅ | ✅ |
| legal | ✅ | ✅ | ✅ |
| states | ✅ | ✅ | ✅ |

## 说明

- 390、900、1180、1440 已覆盖全部 19 页；1440 文件为同目录 `*-1440.png`。
- 其中 `blueprint-{390,900,1180,1440}.png` 是 `#291` 的 post-V1 候选，未获得作者四档视觉签收，不属于已签收 V1 基线。
- Playwright 74 个结构测试通过；CI 使用 Chromium 执行同一套测试。
