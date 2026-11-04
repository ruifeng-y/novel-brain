# M1–M3 Ticket Map v2

> Updated: 2026-11-04.
> #84–#104 are milestone packages/integration tasks where stated below. Do not send a package parent to /implement as one oversized change. Leaf tasks #106–#152 are the bounded implementation units. Dependencies are normative in both the issue body and docs/planning/v1-issue-dependency-graph.json.

## 1. Ticket taxonomy

| Type | Purpose | /implement policy |
| --- | --- | --- |
| Milestone spec | Product scope and release outcomes (#80–#82) | Never implement as a single ticket |
| Package / epic | Integrates several bounded child issues | Implement children first; parent closes with integration evidence |
| Leaf implementation | One coherent schema/API/Worker/UI or benchmark slice with direct blockers and testable acceptance | Eligible only after every blocker is integrated and the owner confirms readiness |
| Integration / release gate | Cross-feature E2E, UI parity, benchmark or human acceptance | Run after dependent leaf work is integrated; never substitute for missing feature implementation |

"Mapped" in the capability ledger means ownership is assigned, not ready-to-start. Labels do not override dependency blockers.

## 2. M0 baseline

- Spec: #66.
- Leaf implementation: #67–#79.
- Initial frontier: #67.
- M0 baseline contracts already exist in docs/technical/m0-protocol-freeze.md and the signed-off prototype documents.
- M0 tickets establish the first production skeleton, auth/model configuration, work creation/import, Story Bible/minimum settings, chapter/editor/generation, fact review/canon submission and M0 E2E/UI/security closeout.

## 3. M1 — single-genre full authoring loop

| Package / integration | Bounded implementation issues | Main capability ownership |
| --- | --- | --- |
| #84 Story Bible and settings foundation | #143 nine-card Story Bible; #144 settings IA/entities/aliases/custom fields | ONBOARD-001/002/004; SET-001/002/011/012 |
| #85 World simulation domain | #106 character/relationship/knowledge; #107 factions/maps/timeline; #108 power/special mechanisms/items/resources | ONBOARD-005; SET-003–010 |
| #86 Outline and story ledgers | #145 five-level outline/volume/scene; #146 plotlines/foreshadows/character arcs | ONBOARD-006/007; PLAN-001/002/004/006/007 |
| #87 Golden Three and readiness | #147 candidate generation/review/lock; #148 readiness gate/remediation | ONBOARD-008; PLAN-003/005; GEN-009 |
| #88 Agent Runtime | #109 contracts/grants/tools; #110 orchestrator/state machine; #111 context compiler; #112 structured retrieval; #113 summaries/invalidation; #114 provenance/cost trace; #115 idempotency/checkpoint/recovery | AGENT-001–006, AGENT-008–011 (AGENT-007 deferred) |
| #89 Advanced writing and critique | #116 writing actions/local rewrite; #117 Critic/quality findings/annotations; #118 targeted revision/feedback/diff; #119 voice/style drift | GEN-002/004/005; QUALITY-001/002/007/008 |
| #90 M1 volume audit and signed xianxia sample | Integration/evaluation closeout after #84–#89 | QUALITY-005 |

Additional M1 feature tickets:
- #141 account profile, pen names, password recovery and sessions (ACCT-002–004).
- #142 work settings, archive/restore, copy/trash lifecycle (WORK-006–008).

M1 integration rule: #85/#86/#87/#88/#89 are package parents. The leaf tickets own implementation. #90 is the volume-level audit and signed sample acceptance, not a substitute for domain/runtime implementation. #141/#142 complete account/work settings omitted from the original coarse M0/M1 split.

## 4. M2 — multi-genre, batch production and canon revisions

| Package / integration | Bounded implementation issues | Main capability ownership |
| --- | --- | --- |
| #91 Batch job orchestration | #151 job hierarchy/work-item DAG; #152 execution/pause/resume/retry/failure isolation | GEN-007/008 |
| #92 History and urban Genre Packs | Existing bounded pack implementation; consumes #84/#85 contracts | ONBOARD-003 and genre-specific settings |
| #93 Batch approval and cost controls | #149 approval predicate/review queue; #150 cost reservation/settlement/hard stop | GEN-010/011; QUALITY-004 |
| #94 Change requests and impact analysis | #120 request/risk classification; #121 impact graph/affected chapters; #122 atomic apply/rollback | CHANGE-001–003 |
| #95 Parallel branches and selective merge | #123 branch creation/global context; #124 object diff/selective decisions; #125 high-risk gate/apply/rollback audit | CHANGE-004–009 |
| #96 Large import and search | #126 large-file chunking/checkpoint; #127 optional settings extraction/conflicts; #128 Chinese search/index update/rebuild | IO-001–003; SEARCH-001/002 |
| #97 Notifications and M2 integration | Existing bounded notification lifecycle and integration acceptance | NOTIFY-001 |

M2 guardrail: #110 owns Agent orchestration state/Workflow Envelope, #115 owns common durable recovery, and #151/#152 compose them for batch work. Do not duplicate those contracts. #93 consumes the batch hierarchy rather than rebuilding it.

## 5. M3 — release, operations and scale proof

| Package / integration | Bounded implementation issues | Main capability ownership |
| --- | --- | --- |
| #98 Export | #129 formats/scope/version manifest | IO-004 |
| #99 Publish and content governance | #130 publish checks/metadata/preview; #131 help/legal/AI disclosure/appeal | IO-005; SEC-005 |
| #100 Security and lifecycle | #132 RLS/authorization audit; #133 log/trace redaction; #134 account export/deletion/purge | SEC-002–004/006; ACCT-005/006; IO-006 |
| #101 Operations | #135 deploy/health/metrics/alerts; #136 backup/restore/RPO/RTO | OPS-001–003; IO-007 |
| #102 10M capacity certification | #137 deterministic data generator, workload and capacity/recovery benchmark | PERF-001 |
| #103 Quality and release evaluation | #138 long-horizon continuity fixture; #139 fixed dataset/rubric/regression; #140 real-provider smoke/canary/rollback | CONT-001; QUALITY-006; EVAL-001–004 |
| #104 V1-wide UI parity/release closeout | Aggregates page-level evidence for all 17 production pages and approved deviations | UI-001–009 |

## 6. Cross-cutting benchmark gates

Two independently required claims were added to the manifest and traceability ledger:

- **PERF-001 / #137:** Can the integrated system store, retrieve, edit, index, import/export and recover a 10,000,000-character work on the pinned 8 vCPU / 16 GB RAM / 100 GB SSD baseline?
- **CONT-001 / #138:** Can the system preserve canon, per-character knowledge, state transitions, time, plotlines and foreshadowing across 3,000–4,000 chapters / 30–40 volumes, while keeping Agent autonomy within its grant?

Passing one does not imply passing the other. See docs/performance/v1-10m-capacity-benchmark.md and docs/quality/v1-long-horizon-continuity-benchmark.md.

## 7. Dependency graph and readiness

- Machine-readable blocker graph: docs/planning/v1-issue-dependency-graph.json.
- Validator: scripts/validate-readiness.mjs.
- Run from repository root: `node scripts/validate-readiness.mjs`.
- The validator checks manifest ↔ traceability set equality, one primary issue per V1 capability, production UI page ownership/evidence paths, prototype-only states page, missing issue nodes, self-dependencies and dependency cycles.
- The graph's `blocked_by` edges represent implementation blockers. Package-child membership is represented separately as `children`; closing a package requires its children and its stated integration gates.
- GitHub native dependency edges are not assumed. Until native edges are available, issue bodies plus this graph are the canonical dependency record.

## 8. Completion rules

1. Confirm source design and accepted ADR before changing schema, state machine, API or UI contracts.
2. Freeze shared identifiers/contracts before parallel implementation. Parallelize only disjoint schemas or isolated modules.
3. Every leaf issue implements only its scope and records migrations, contracts, API/Worker behavior, focused tests, relevant E2E/UI evidence and code review.
4. Every table that stores user/work/story data ships with RLS and tenant-isolation tests in the owning feature PR; #132 is an aggregate audit, not permission to defer local security.
5. Every UI task updates the corresponding row in docs/ui/v1-ui-parity-matrix.md. Prototype screenshots are reference inputs; production golden images are created only after author sign-off.
6. No implementation claim is upgraded to verified without evidence. No capacity or narrative-quality claim is made without the respective benchmark report.
