# M3-07c-01 Non-UI V1 Capability Evidence Audit

> Issue: #236
> Audited: 2026-11-24; updated 2026-11-27 after the CONT-001 V1 deferral
> Machine-readable ledger: `docs/implementation/m3-236-non-ui-capability-evidence.json`
> Verification: final PR Production CI
> [run 45944913873](https://github.com/ruifeng-y/novel-brain/actions/runs/45944913873)
> on code head `e204faa`; the final release-evidence gate remains separate.
> Result: 106 / 106 non-UI V1 capabilities verified.

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
| Verified | 106 |
| Blocked by a bounded gap | 0 |
| Missing audit record | 0 |

No non-UI V1 capability remains in a bounded gap.

`PERF-001`, `CONT-001`, `AGENT-007` and `QUALITY-009` remain authorized post-V1 deferrals and
are not part of this audit. CONT-001's historical #239/#273 evidence is retained, but no clean
204-sample human review claim exists for V1.

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
```

EVAL-002 is verified against Production CI run `45944913873` at head `e204faa`. The remaining
release blocker is the final release-evidence gate itself. CONT-001 is explicitly deferred and
#279 is no longer a V1 deliverable. UI capability closure was completed by #238.
