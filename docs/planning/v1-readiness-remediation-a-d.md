# V1 Design & Delivery Readiness Remediation — Stages A–D

> Date: 2026-11-04
> Branch: `docs/readiness-remediation-a-d`
> Scope: design/issue/evidence readiness only. This change does not implement the production application and does not certify performance or narrative quality.

## Executive status

The repository's design baseline is more traceable and implementation-oriented after this remediation. Product and architecture choices remain in place; the work focuses on ownership, task boundaries, dependencies and testable release claims.

| Stage | Result | Status |
| --- | --- | --- |
| A — Capability and scope traceability | 119 capability IDs, unique primary owner per V1 capability, deferred items explicit | Documentation baseline complete |
| B — UI parity and prototype traceability | 17 production page contracts + 1 prototype-only gallery; page owners/spec/golden paths assigned | Documentation baseline complete; production evidence pending |
| C — Leaf-ticket decomposition and dependency control | 47 new leaf issues (#106–#152), package parents clarified, 85-node/316-edge DAG and validator | Documentation baseline complete; implementation pending |
| D — 10M capacity and long-horizon continuity proof | Two independent benchmark specifications and two cross-cutting capability gates | Test specifications complete; benchmark execution pending |

## Stage A — Capability ownership and requirements traceability

Files:
- `docs/planning/v1-capability-manifest.md`
- `docs/planning/v1-capability-traceability.md`

Changes:
- Preserved the 117 original capability IDs and added PERF-001 (10M capacity/recovery) and CONT-001 (3,000–4,000 chapter continuity), for 119 total.
- Rebuilt primary ownership from actual capability scope in Issues rather than retaining the earlier broad/mismatched mappings.
- Every V1 capability has one primary issue. Supporting issues are explicitly distinguished from primary ownership.
- AGENT-007 vector retrieval and QUALITY-009 real-reader feedback remain deferred/post-V1.
- Replaced the ambiguous notion of “ticketed” with explicit mapped/ready/in-progress/implemented/verified/released states. Mapping does not imply startability.

Key corrected ownership examples:
- ACCT-001 → #68; ACCT-007/008 and SEC-001 → #69.
- WORK-004 → #70; ONBOARD-005 → #106.
- GEN-007/008 → #151/#152; Agent state-machine/recovery primitives remain #110/#115.
- PERF-001 → #137; CONT-001 → #138.
- UI-001–UI-009 remain global cross-cutting capabilities owned by #104, with M0 closeout support from #79 and implementation evidence on the page feature issues.

## Stage B — Production UI parity

File:
- `docs/ui/v1-ui-parity-matrix.md`

Changes:
- Distinguished 17 production page contracts from the prototype-only `states` gallery.
- Assigned a leaf primary page owner and supporting feature issues to every production row.
- Named the expected per-page production Playwright spec path:
  `apps/web/e2e/parity/<page>.spec.ts`.
- Named the expected production golden screenshot path:
  `artifacts/ui/golden/<page>/<page>-{390,900,1180,1440}.png`.
- Kept prototype reference screenshots separately under `prototype/screens/v1-baseline/`.
- Defined state/action/API, four-viewport, visual comparison, author-language and deviation-approval criteria.
- All 17 production pages remain `production-pending`; production test files and production golden images do not yet exist. The prototype baseline cannot be counted as production parity evidence.

Prototype baseline evidence retained:
- 18 prototype pages (17 production-contract pages + states gallery).
- 72 screenshots across 4 viewports.
- 49 Playwright assertions (prototype-only baseline).

## Stage C — Ticket decomposition and dependency DAG

Files:
- `docs/planning/m1-m3-ticket-map.md`
- `docs/planning/implementation-frontier.md`
- `docs/planning/v1-issue-dependency-graph.json`
- `scripts/validate-readiness.mjs`
- `docs/implementation/README.md`

Changes:
- Created 47 leaf issues, #106–#152, each with a bounded scope, blockers, acceptance criteria and out-of-scope boundary.
- Reclassified large work packages so the parent is an integration/epic tracker and children own implementation:
  - M1: #84–#89; additional account/work settings #141/#142.
  - M2: #91, #93–#96.
  - M3: #98–#103.
- #91 is now a batch package; #151 owns task hierarchy/DAG planning and #152 owns execution/pause/resume/failure isolation. #110/#115 remain the Agent orchestration and common recovery primitives.
- #102 and #103 no longer self-depend; missing PERF-001 and CONT-001 ownership has been added.
- Resolved the #122/#123 branch/apply dependency cycle by making the existing M0 version graph the branch foundation.
- Resolved the security/operations cycle: #133 hardens logs before #135 consumes them; #134 defines deletion/retention before #136 proves restore/expiry behavior.
- Resolved the quality/continuity cycle: #138 defines the long-horizon fixture; #139 consumes it into the fixed quality registry.
- Parent-child membership is distinct from blocker dependencies; this prevents a child from waiting on a parent that itself waits for that child.

Dependency graph snapshot:
- 85 issue/spec nodes.
- 316 blocker edges.
- No missing references, self-dependencies, parent/child mismatches or cycles in the structural validation pass.

Run locally from repository root:

```bash
node scripts/validate-readiness.mjs
```

The validator checks manifest/traceability set equality, capability primary mappings, UI row coverage and production evidence paths, package-child consistency, missing blocker nodes, self-dependencies and DAG cycles.

## Stage D — Release proof specifications

Files:
- `docs/performance/v1-10m-capacity-benchmark.md`
- `docs/quality/v1-long-horizon-continuity-benchmark.md`

### PERF-001 / #137

Specifies:
- deterministic 10,000,000-character dataset generation;
- 3,500-chapter/35-volume canonical topology and 4,000-chapter/40-volume boundary topology;
- manuscript/version/branch/index/object-storage/job data generation;
- interactive read/edit/search/context, batch jobs, import/index rebuild, export, SSE and branch/change workloads;
- p50/p95/p99, throughput, error rate, queue wait, CPU/RAM/IO, database/index/object/backup size, provider costs and measured RPO/RTO;
- worker/process/database/Redis/provider/disk/object/backup failure injection.

Existing p95/search/streaming/SSE and RPO/RTO goals are retained from the backend design. p99 limits, API concurrency, allowable errors, disk headroom and other unapproved gates are explicitly decision-required.

### CONT-001 / #138

Specifies:
- 3,000–4,000 chapter / 30–40 volume deterministic ground truth;
- objective canon vs each character's knowledge/belief/suspicion/misbelief/unknown;
- body/limb/ability/age/lifespan/equipment/resource/rights/location/time/relationship invariants;
- death/resurrection/possession/reincarnation/clones/avatars/soul transfer;
- plotlines, foreshadow setup/payoff, character motivation/arc, branch divergence and style/voice evolution;
- agent detection → evidence → bounded proposal → Grant check → safe action or human escalation → Change Ledger → post-action recheck;
- automated precision/recall and zero-tolerance P0/knowledge leakage gates, plus stratified human blind review.

Capacity and continuity are independent release gates. Passing one cannot compensate for failing the other.

## Remaining decisions and work

The following are intentionally not marked complete:

1. Product/operations decisions still needed for numeric p99 thresholds, concurrent API users, acceptable saturation/error rate, disk headroom, backup storage envelope and required human-review sample/agreement thresholds.
2. Production Web/API/Worker code has not started. M0 implementation still begins at #67.
3. Production Playwright specs and golden screenshots must be created by the owning page tasks and signed off against a running application.
4. The 10M dataset and long-horizon continuity fixture have not been generated or executed against a production schema.
5. No load test, restore drill, cross-volume model run or blind human review is claimed as passed.
6. The pull request is not merged; review and approval are required before these changes become the main-branch baseline.

## Acceptance of this remediation

This remediation is complete when the PR contains the four-stage documents, package/leaf mapping, capability ledger, UI matrix, machine-readable DAG, validator and benchmark specifications; the validator passes against the exact branch content; and no production readiness claim is made ahead of real implementation evidence.
