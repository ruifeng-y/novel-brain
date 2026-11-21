# Implementation frontier v2

> Updated: 2026-11-21.
> Repository baseline: `main@0ab8adc`, after PR #260 completed the page-level action audit.

## 1. Current truth

- M0 production Web/API/Worker source exists through integrated #67–#78; #79 records closeout evidence and remaining demo gates. The signed-off prototype remains the UI baseline, not production evidence by itself.
- M1 leaf implementation is present in the integrated codebase and is recorded in `docs/implementation/m1-spec-closeout.md`. #142 account/work lifecycle is closed through PR #211 and recorded in `docs/implementation/m1-142-work-settings.md`.
- M2 production implementation is integrated through #185. Issues #91–#97 and #120–#128 are closed with Production CI evidence.
- M0 specification: #66; M0 implementation tickets: #67–#79.
- M1 specification: #80; M1 package/integration tickets: #84–#90.
- M2 specification: #81; M2 package/integration tickets: #91–#97.
- M3 specification: #82; M3 package/integration tickets: #98–#104.
- New bounded leaf tickets: #106–#152. They are mapped; their existence does not make them startable.
- PR #105 established the first M1–M3 ticket layer; PR #153 subsequently added bounded leaf tasks, unique capability ownership, explicit UI evidence paths and independent scale/quality gates.
- Review decisions #162, #165 and #166 are closed. #147 and durable Worker follow-up #190 are closed.
- #90 product acceptance is complete after the author signed both the fixed 40-chapter sample audit and a clean-volume audit on 2026-11-13.
- The M3 tenant authorization audit #132 is closed. Logging and trace hardening #133 is closed through PR #195; deployment, health, metrics and cost alerting #135 is closed through PR #196; account lifecycle #134 is closed through PR #199.
- #136 backup/restore/RPO/RTO is closed through PR #200.
- #129 export formats, scope selection, durable job recovery and version manifests is closed through PR #201.
- #130 publish checks, catalog metadata and reader preview is closed through PR #203.
- #131 help/legal content, AI disclosure and moderation appeal is closed through PR #207. `legal` and `export-publish` have formal Linux Golden evidence, but current release status is matrix-owned: only `legal` is `parity-verified`, and #104 removed the earlier `help` verification because no real route-level error-boundary evidence exists.
- Readiness was recomputed against the dependency graph and GitHub issue states on 2026-11-18. #142, #138, #139 and #140 are closed; #98–#103 package parents are closed with child evidence; #137/#102 are explicitly deferred from V1 and the V1 capacity claim is excluded.
- #104 is in implementation through #236 and its child tickets: all 17 non-static production pages are currently `parity-verified`. The page-level per-action API/persistence audit is complete. #236 audited 107 non-UI V1 capabilities: 101 are `verified`; WORK-002, IO-001, IO-003, EVAL-002, EVAL-003 and CONT-001 remain open with bounded follow-ups.
- PR #213 closed the #142 delivery retro through Issue #212: commit validation now accepts common project terms in Chinese prose, and parity screenshot failures are collected across all viewports in one run.

## 2. Immediate frontier

1. Finish #104 release closeout through #238 and the final CI/release decision. The 17-page per-action API/persistence audit and the #236 non-UI capability evidence audit are complete; #261/#262 cover the two implementation/evidence gaps found by #236.
2. Do not treat automated quality gates as release approval: real blind-human evidence and the approved inter-rater variance threshold remain outstanding.
3. Run the manual `provider-smoke` workflow with the protected environment secret and attach redacted evidence before claiming real-provider validation.
4. #137/#102 remain deferred outside V1; resuming the 10M capacity claim requires a new explicit decision and a fresh benchmark.

## 3. First executable frontier (historical)

Only #67 is the M0 starting point. After #67 is implemented, reviewed and integrated, follow the blocker graph and issue bodies. Do not infer readiness from milestone order or labels.

M0 first-order sequence:
- #67 skeleton/health/contracts/fake provider.
- #68 and #69 may proceed after #67 when shared auth/model contracts are frozen.
- #70 follows #67/#68; #71/#72/#73 depend on #70.
- #74 follows #73; #75 follows #73/#74.
- #76 follows #69/#74/#75; #77 follows #76; #78 follows #75/#77.
- #79 is M0 integration and UI/security/real-provider closeout after #68–#78.

## 4. M1 leaf sequencing

M1 foundations:
- #143 after M0 #70/#73; #144 after #74/#143.
- #106–#108 consume #144 and M0 #74; share IDs/version/tenant contracts before parallel DB work.
- #145 depends on #143/#144 and #106–#108; #146 depends on #143/#145/#106.
- #147 depends on #143/#145/#76; #148 consumes #143/#144/#145 and required domain/M0 contracts.
- Agent Runtime: #109 after #67/#69/#144; #110 after #109/#76; #111 after #143/#144/#106–#108/#76; #112 after #106–#108/#111; #113 after #145/#146/#111/#112; #114 after #109/#110/#69/#76; #115 after #110/#114.
- Writing: #116 consumes #109–#115 and #145/#146; #117 consumes domain/runtime/critic prerequisites; #118 follows #116/#117; #119 follows #106/#145/#146/#117.
- #90 integrates M1 package outputs and the signed xianxia sample; it is not a shortcut around unfinished child work.
- #141 follows #68/#69; #142 follows #70, with irreversible deletion behavior coordinated with #134.

## 5. M2 leaf sequencing

- #151 consumes #110; #152 consumes #151/#115. #91 is the package/integration parent.
- 2026-11-07：#151 已完成批量计划层级、`job_work_items`、DAG 校验、并发策略和幂等 API；执行状态机仍由 #152 负责。证据见 `docs/implementation/m2-01a-batch-plan.md`。
- 2026-11-07：#152 已完成批量执行 tick、暂停/恢复/取消/重试、失败隔离、审计与检查点复用；审核决策仍由 #149 负责。证据见 `docs/implementation/m2-01b-batch-execution.md`。
- 2026-11-07：#91 的 API/Worker 包验收已由 #151/#152 满足，但 Batch 页面、审核队列和成本报告尚缺，父包保持打开。签收矩阵见 `docs/implementation/m2-01-batch-orchestration-closeout.md`。
- #92 adds history/urban Genre Packs after the #84/#85 contracts.
- #149/#150 consume #91 plus the Critic/readiness and runtime provenance/recovery contracts; #93 is their package parent.
- 2026-11-07：M2-03 依赖按代码完成状态收口，见 `docs/planning/m2-03-dependency-acceptance.md`；#149/#150 可在新上下文实现，但不关闭 #91/#114/#115/#117/#147。
- #120 → #121 → #122 is the change request/impact/apply path.
- #123 uses the M0 version graph and #144/#106–#108; #124 consumes branch and impact/diff contracts; #125 consumes selective decisions and high-risk policy.
- #126/#127 provide large import and optional setting extraction; #128 adds Chinese search/indexing after relevant data/retrieval/import contracts.
- #97 integrates notifications and page-level M2 acceptance.

2026-11-12: #185 integrated all M2 leaves, batch/changes parity, notifications, imports/search and final Linux Golden evidence. M2 is closed; the section remains as dependency history.

## 6. M3 release and proof sequencing

- #129 export, #130 publish checks/preview and #131 help/legal/AI disclosure and appeal are complete.
- #132 RLS/authorization coverage and #133 logging/trace hardening are complete. Every new tenant-owned table still requires RLS coverage.
- #135 deployment, health, metrics and cost alerting is complete. Backup expiry and restore evidence remain with #136.
- #134 and #136 are closed. PR #200 carries the backup/restore and retention evidence.
- #129 follows #136; #130 follows #129; #131 follows #130. #137 follows #134 and #136; #142 is closed through PR #211.
- #138 has deterministic 3,500-chapter full and 4,000-chapter maximum evidence. Its report remains intentionally blocked pending actual human blind review, approved thresholds and narrative evidence; merge closes the implementation/fixture contract, not the release-quality claim.
- #138 is closed through PR #216.
- #139 consumes the pinned long-horizon fixture into a frozen three-genre dataset, release rubric and cross-run P0 regression gate. It does not replace real human review.
- #140 gates real-provider canary/rollback after #139.
- #104 is the V1-wide UI closeout and is last among page parity aggregators.

## 7. Package-parent rule

Do not pass these package parents to /implement as one task: #84–#89, #91, #93–#96, #98–#103. Implement their bounded child issues first and close the parent with integration evidence. #90, #97 and #104 are integration gates; they are not substitutes for feature work.

Full map and dependency graph:
- docs/planning/m1-m3-ticket-map.md
- docs/planning/v1-issue-dependency-graph.json
- docs/planning/v1-capability-traceability.md
- docs/ui/v1-ui-parity-matrix.md

Run the static checks from repository root:
```bash
node scripts/validate-readiness.mjs
```

Do not start a task if its dependency graph says a blocker is open, its capability primary owner is missing, or a required product/ADR decision remains unresolved.
