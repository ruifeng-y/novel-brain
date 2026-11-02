# M3 / V1 总验收资料

本目录记录 GitHub issue #33「M3-06 V1 总验收」及 M3-01 到 M3-05 的最终复验证据。

- `acceptance.md`：V1 总验收记录、第 12 节完整矩阵、#1-#33 ticket 矩阵、发布阻断项和最终结论。
- `demo.md`：M3 / V1 发布候选演示脚本和门禁命令。
- `performance/`：3,000,000 字、1,000 章基准的原始指标。
- `security-audit.md`、`security-audit/`：安全测试、依赖审计和残余风险。
- `restore-drill.md`、`restore-drill/`：Postgres 与对象存储恢复演练证据。

`808a16b` 复验原始证据：

- `performance/v1-acceptance-808a16b-metrics.json`
- `security-audit/2026-11-03-v1-rerun.json`
- `restore-drill/20261102T183431Z.json`

> 结论：B-01/B-02/B-03/B-04/B-07 工程门槛已由 #34-#37 关闭并通过
> `808a16b` 复验；局域网/内部发布候选为 GO。完整 V1 仍缺 B-12/B-13 功能，
> 公开发布仍被 B-05 人工质量、B-06 真实 DeepSeek、B-08 法务和 B-07 真实部署
> 证据阻断，不是已批准的公开发布版本。
