# Implementation frontier and readiness ledger

> Baseline commit: b7b67f0856723c87a12da3a0395989daa926eaa0 (main, 2026-11-04 snapshot).
> Implementation branch: chore/implementation-readiness.
> Updated: 2026-11-04.

## Current readiness

| Area | State | Evidence / next action |
| --- | --- | --- |
| Product baseline | accepted | Requirements, capability manifest, ADRs 0001–0024 |
| Technical baseline | accepted for M0 start | NestJS backend design and M0 protocol freeze; validate contracts during implementation |
| UI baseline | signed off | 18 pages, 72 Chromium screenshots, parity matrix and sign-off |
| Production application | not started | Start M0 #67 |
| M0 task graph | ticketed | #67–#79; initial frontier #67 |
| M1 task graph | ticketed | #84–#90; dependency graph in docs/planning/m1-m3-ticket-map.md |
| M2 task graph | ticketed | #91–#97; dependency graph in docs/planning/m1-m3-ticket-map.md |
| M3 task graph | ticketed | #98–#104; dependency graph in docs/planning/m1-m3-ticket-map.md |
| V1 capability mapping | mapped | 117 manifest IDs mapped to primary issues; see docs/planning/v1-capability-traceability.md |
| Production parity | pending | No production app pages implemented yet |
| 10M scale certification | pending | #102 defines evidence requirements; no certification claimed |

## M0 frontier
Initial frontier: **#67 only**. Subsequent M0 tickets follow docs/implementation/README.md and their GitHub blockers.

## M1 frontier
Initial M1 start: **#84**, after M0 core contracts are stable. Follow #84 → #85 → (#86, #88) → #87/#89 → #90. Parallelize only where schema and contract ownership do not overlap.

## M2 frontier
M2 starts after M1 authoring/runtime foundations (#88/#89) and domain contracts (#84/#85). #92 may run independently of batch after #84/#85. #94 precedes #95. #97 is the integration closeout.

## M3 frontier
M3 is release hardening, not feature-first development. #98–#103 can progress when their upstream M2 contracts exist; #102 requires batch/search/branch/storage. #104 is final parity and release evidence closeout.

## M1–M3 decomposition
See docs/planning/m1-m3-ticket-map.md for the ticket index, explicit blockers, parallelization rules and milestone ownership. Every implementation ticket includes capability IDs, scope, tests and UI parity mapping.

## Review and release exit criteria
1. The issue is bounded and all blockers are closed.
2. Capability IDs and design sources are linked.
3. Acceptance criteria can be tested without guessing.
4. Affected contracts and file ownership are clear.
5. UI tickets update the parity matrix and attach four-viewport evidence.
6. Every V1 capability is verified or explicitly deferred with owner and rationale.
7. V1 release requires M0–M3 gates, 10M performance/recovery evidence, quality benchmark, security and backup/restore evidence.
