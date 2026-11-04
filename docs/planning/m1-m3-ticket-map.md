# M1–M3 Implementation Ticket Map

> Baseline: V1 capability manifest, accepted ADRs 0010–0024, milestone specifications #80–#82, and UI parity matrix.
> Created: 2026-11-04. Issue creation is not implementation verification.

## 1. Ticket index

| Milestone | Issue | Work package | Primary capability coverage |
| --- | --- | --- | --- |
| M1 | #84 | Story Bible, genre baseline and settings core | ONBOARD-001/002/004, SET-001/002/011/012 |
| M1 | #85 | World simulation domain | ONBOARD-005, SET-003–010 |
| M1 | #86 | Five-level outline and story ledgers | ONBOARD-006/007, PLAN-001/002/004/006/007 |
| M1 | #87 | Golden three and readiness gates | ONBOARD-008, PLAN-003/005, GEN-009 |
| M1 | #88 | Agent runtime, context compiler and continuity retrieval | AGENT-001–006, AGENT-008–011 |
| M1 | #89 | Writing desk, critics, annotations and fact loop | GEN-001–006, QUALITY-001–003/007/008 |
| M1 | #90 | Volume audit, xianxia sample and M1 acceptance | QUALITY-005 |
| M2 | #91 | Batch DAG and agent work-item orchestration | GEN-007/008 |
| M2 | #92 | History and urban genre packs | ONBOARD-003 |
| M2 | #93 | Batch approval, cost hard stop and task center | GEN-010/011, QUALITY-004 |
| M2 | #94 | Change requests and impact analysis | CHANGE-001–003 |
| M2 | #95 | Parallel branches, object diff and selective merge | CHANGE-004–009 |
| M2 | #96 | Large import, full-text search and index rebuild | IO-001–003, SEARCH-001/002 |
| M2 | #97 | Notifications, M2 UI parity and integration | NOTIFY-001 |
| M3 | #98 | Export tasks, formats, manifests and download history | IO-004 |
| M3 | #99 | Publish checks, preview, help/legal and content governance | IO-005, SEC-005 |
| M3 | #100 | Security, privacy, tenant isolation and deletion | SEC-001–004/006, IO-006 |
| M3 | #101 | Deployment, observability, backup and operations | OPS-001–003, IO-007 |
| M3 | #102 | 10M capacity, retrieval, concurrency and recovery benchmark | Cross-cutting performance gate |
| M3 | #103 | Fixed quality benchmark, model rollout/rollback and release gate | QUALITY-006, EVAL-001–004 |
| M3 | #104 | V1 UI parity, documentation and final release acceptance | UI-001–009 |

## 2. Dependency graph

The relations below are normative implementation blockers. The connected GitHub integration does not expose native issue-dependency mutation, so each issue body and this map state blockers explicitly. Do not infer readiness from labels alone.

```text
M0 #67–#79
  └─> M1 #84 ─> #85 ─┬─> #86 ─> #87 ─┐
                     └─> #88 ────────┤
M0 #75–#78 ────────────────────────> #89 ─> #90

M2 #91 (after #88/#89) ─┬─> #93 ─┐
   #92 (after #84/#85) ─┘       │
   #94 (after #85–#89) ─> #95 ──┤
   #96 (after #85/#86/#91) ─────┤
   #97 (after #91–#96) <────────┘

M3 #98 (after #96) ─┐
   #99 (after #98) ─┤
   #100 (M0 security + all M1/M2 tenant tables) ─┤
   #101 (after #67 and storage contracts) ──────┤
   #102 (after #91/#93/#95/#96 and #101) ────────┤
   #103 (after #89/#91–#97) ─────────────────────┤
   #104 (after all M1–M3 page work) <────────────┘
```

### Parallelization and ownership rules
- Parallelize only across tickets with non-overlapping mutable schemas/contracts and explicit package ownership.
- #84 and stabilized M0 integration may proceed first; #85 follows #84; #86 follows #84/#85; #88 follows #85 and M0 runtime contracts; #89 follows M0 writing/fact gates and #85–#88.
- #92 can proceed after #84/#85 independently of batch orchestration. #94 follows the M1 domain model; #95 waits for the canonical version graph and impact contracts.
- #100 is cross-cutting: every new tenant table must receive RLS and cross-user tests when introduced, not only at final hardening.
- #102 cannot certify 10M scale before batch, search, branching and storage behavior exists.
- #104 is final integration/release evidence, not a substitute for page-level parity work inside feature tickets.

## 3. Corrected capability ownership overlay
The capability manifest table does not carry a milestone column. This map and the traceability ledger define ownership:
- M1: xianxia core authoring, structured settings, planning, runtime/context, single-chapter authoring and volume audit.
- M2: history/urban genre packs, batch orchestration/approval, change impact, parallel branches/merge, large import/search and notifications.
- M3: export/publish, compliance/security closure, deployment/backup, 10M capacity, full benchmark and release gates.
- UI-001–UI-009 are cross-cutting and map to #104 for release-wide closure; page feature tickets still own their page-specific parity evidence.
- AGENT-007 (vector retrieval) and QUALITY-009 (real reader feedback) remain post-V1/deferred and are not V1 deliverables.
- IO-006 (account data export) is tracked under #100 because its acceptance is security/privacy data portability and secret exclusion; ACCT-005 remains its M0 account-facing entry point.

## 4. Ticket acceptance and traceability rules
1. Each issue #84–#104 is a bounded vertical package, not permission to rewrite an entire milestone.
2. Every V1 capability ID has a primary issue in docs/planning/v1-capability-traceability.md.
3. A ticket cannot close until API/data/worker tests and relevant UI parity/evaluation evidence are attached.
4. UI work updates docs/ui/v1-ui-parity-matrix.md: issue, parity test, production golden and status.
5. Schema changes include tenant/RLS, versioning, migration, idempotency and recovery considerations.
6. PostgreSQL owns durable jobs/checkpoints; Redis/BullMQ is transport only.
7. Agent tasks cannot exceed their grant, budget, tool allowlist, task envelope or workflow depth/concurrency constraints.
8. No V1 release claim until all manifest IDs are verified or explicitly authorized deferred and M3 release gates pass.

## 5. Readiness status
- M1 #84–#90: ticketed; not implemented or verified.
- M2 #91–#97: ticketed; not implemented or verified.
- M3 #98–#104: ticketed; not implemented or verified.
- M0 #67–#79: ticketed; initial implementation frontier remains #67.
- Parent specs #80–#82 remain the specification parents. Use child implementation issues for /implement, not the parent specs.
