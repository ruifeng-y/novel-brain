# M3-07c-01 Non-UI V1 Capability Evidence Audit

> Issue: #236
> Audited: 2026-11-24; updated 2026-11-26 after #240 approval, #271 verification and #273 preparation
> Machine-readable ledger: `docs/implementation/m3-236-non-ui-capability-evidence.json`
> Verification: historical #236 audit baseline from
> [Production CI #45332565381](https://github.com/ruifeng-y/novel-brain/actions/runs/45332565381)
> on code head `491d059`; current release-head verification remains #242.
> Result: 105 / 107 non-UI V1 capabilities verified; 2 retained as implemented with bounded gaps.

## 1. Audit Rule

Each non-UI V1 capability must point to at least one executable contract, unit,
integration, E2E, benchmark or guardrail test. A documentation path alone cannot verify a
capability. Manual sign-off may support an executable test, but cannot replace it.
Verified capabilities also require a successful normal PR Production CI run bound to the
audited code head; that workflow covers unit, integration and Playwright jobs.

The release gate now validates:

- every non-UI V1 capability has exactly one audit record;
- a verified audit record matches a `verified` traceability row;
- every evidence path exists;
- every verified capability has at least one executable evidence item;
- every blocked capability names a bounded follow-up issue;
- traceability and the audit ledger cannot drift silently.

## 2. Results

| Status | Count |
| --- | ---: |
| Verified | 105 |
| Blocked by a bounded gap | 2 |
| Missing audit record | 0 |

The two blocked capabilities are:

| Capability | Gap | Follow-up |
| --- | --- | --- |
| EVAL-002 | The variance threshold is approved, but final release-head Production CI has not yet bound the complete evidence set. | #242 |
| CONT-001 | Deterministic continuity evaluation passes and #239 records human raw scores. #273 records 24/24 product-owner replace decisions and invalidates old scores for clean review. #278 must rebuild the clean 204-sample packet and #279 must remediate the benchmark prose and rerun full human review; `hook_prose_score = 1.882353 < 4`. | #278 |

`PERF-001`, `AGENT-007` and `QUALITY-009` remain authorized post-V1 deferrals and are not
part of this audit.

## 3. Evidence Families

- Auth and account lifecycle: HTTP integration plus production Playwright.
- Works, settings, planning and story state: PostgreSQL/Redis HTTP integration.
- Agent runtime, context, generation, review and revision: contract/unit tests plus
  HTTP/Worker integration.
- Batch, changes, search, notification and export: real API integration with RLS and
  cross-tenant assertions.
- Security, backup and operations: tenant RLS inventory, redaction, backup drill and
  deployment/observability guardrails.
- Quality and continuity: frozen benchmark registries, deterministic evaluators and
  release-gate rejection tests, plus the signed human review in
  `docs/quality/evidence/m3-239/`.

The exact path for every capability and evidence item is in the machine-readable ledger.

## 4. Verification

```powershell
pnpm exec vitest run scripts/test/v1-capability-evidence.test.mjs scripts/test/v1-release-gate.test.mjs
node scripts/validate-readiness.mjs
pnpm release:check
```

Expected release result after the #238 UI closeout:

```text
V1 RELEASE BLOCKED
- release-evidence:status-blocked
- final-production-ci:blocked
- human-blind-review:blocked
- capability-verification:2
  EVAL-002, CONT-001
- capability-audit:verification-evidence-missing
```

The final audit blocker is expected until the current PR has an exact-head
Production CI run; #242 records the final release CI.

The remaining non-UI blockers are tracked by #242 and #273 plus the failed quality claim
under #104. UI capability
closure was completed by #238; final release evidence and CI remain #242.
