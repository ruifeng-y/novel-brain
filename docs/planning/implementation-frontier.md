# Implementation frontier and readiness ledger

> Baseline commit: b7b67f0856723c87a12da3a0395989daa926eaa0 (main, 2026-11-04 snapshot).
> Implementation branch: chore/implementation-readiness.
> Update this ledger as tickets are decomposed, implemented and verified.

## Current readiness

| Area | State | Evidence / next action |
| --- | --- | --- |
| Product baseline | accepted | Requirements, capability manifest, ADRs 0001–0024 |
| Technical baseline | accepted for M0 start | NestJS backend design and M0 protocol freeze; validate contracts during implementation |
| UI baseline | signed off | 18 pages, 72 Chromium screenshots, parity matrix and sign-off |
| Production application | not started | Repository has no production app source; start #67 |
| M0 task graph | defined | #67–#79; dependency order in docs/implementation/README.md |
| M1 task graph | not ready | #80 is a parent spec; decompose before implementation |
| M2 task graph | not ready | #81 is a parent spec; decompose before implementation |
| M3 task graph | not ready | #82 is a parent spec; decompose before implementation |
| Full V1 capability-to-ticket mapping | not complete | Reconcile manifest/traceability after ticket decomposition before V1 claim |

## M0 frontier

Initial frontier: **#67 only**.
Subsequent eligible tickets are governed by the dependency graph in docs/implementation/README.md. GitHub issue labels are not a substitute for checking blockers. If an issue body or dependency differs from this ledger, stop and reconcile the two before starting.

## M1–M3 decomposition requirement

The milestone parent issues describe outcomes and contain user stories/decisions, but are too broad for one /implement session. Decomposition must create vertical implementation tickets with:
- bounded user-visible behavior or backend capability;
- exact capability IDs;
- dependency edges and explicit shared-contract prerequisites;
- data/API/worker/UI seams;
- failure, permission, empty, loading and recovery states where applicable;
- deterministic tests plus model-quality tests where relevant;
- measurable acceptance evidence.

M3 performance and quality tickets must define measurable workload, thresholds, environment, dataset, repeat count and artifact format. Do not invent P95/P99 targets without a documented workload and hardware profile; record provisional targets as provisional and require owner approval before release freeze.

## Review exit criteria

The project is ready for /implement at the current frontier when:
1. the issue is bounded and all blockers are closed;
2. its capability IDs and design sources are linked;
3. acceptance criteria can be tested without guessing;
4. affected contracts and file ownership are clear;
5. the implementer can work without reopening product decisions.

The whole V1 is ready for release only after every V1 capability has a verified ticket and evidence, all M0–M3 gates pass, and the 10M performance/recovery/quality evidence is recorded.
