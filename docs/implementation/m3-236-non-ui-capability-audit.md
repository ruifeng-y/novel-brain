# M3-07c-01 Non-UI V1 Capability Evidence Audit

> Issue: #236
> Audited: 2026-11-24; updated 2026-11-25 after #241
> Machine-readable ledger: `docs/implementation/m3-236-non-ui-capability-evidence.json`
> Verification: [Production CI #45332565381](https://github.com/ruifeng-y/novel-brain/actions/runs/45332565381) on code head `491d059`
> Result: 104 / 107 non-UI V1 capabilities verified; 3 retained as implemented with bounded gaps.

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
| Verified | 104 |
| Blocked by a bounded gap | 3 |
| Missing audit record | 0 |

The three blocked capabilities are:

| Capability | Gap | Follow-up |
| --- | --- | --- |
| EVAL-002 | The release-level inter-rater variance threshold is not approved. | #240 |
| EVAL-004 | Smoke response model `deepseek-flash` does not match the canary policy request model `deepseek-chat`. | #271 |
| CONT-001 | Deterministic continuity evaluation passes and #239 records human raw scores, but 24 sample texts expose defect metadata and await adjudication; `hook_prose_score = 1.882353 < 4` and the variance threshold remains unapproved. | #104 |

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
- capability-verification:3
  EVAL-002, EVAL-004, CONT-001
- capability-audit:verification-evidence-missing
```

The final audit blocker is expected until the current PR has an exact-head
Production CI run; #242 records the final release CI.

The remaining non-UI blockers are tracked by #240, #271 and the failed quality claim
under #104. UI capability
closure was completed by #238; final release evidence and CI remain #242.
