# V1 Baseline Screenshots

生成方式：Playwright Chromium headless，读取相对路径
`prototype/index.html#<page>`，执行 `pnpm run capture:screens`。

## 覆盖

| 页面 | 390 | 900 | 1180 |
| --- | --- | --- | --- |
| auth | ✅ | ✅ | ✅ |
| dashboard | ✅ | ✅ | ✅ |
| new-project | ✅ | ✅ | ✅ |
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

- 390、900、1180、1440 已覆盖全部 18 页；1440 文件为同目录 `*-1440.png`。
- Playwright 49 项结构断言通过；CI 使用 Chromium 执行同一套断言。
