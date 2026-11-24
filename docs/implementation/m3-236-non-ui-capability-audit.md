# M3-07c-01 Non-UI V1 Capability Evidence Audit

> Issue: #236
> Audited: 2026-11-24
> Machine-readable ledger: `docs/implementation/m3-236-non-ui-capability-evidence.json`
> Verification: [Production CI #45286994401](https://github.com/ruifeng-y/novel-brain/actions/runs/45286994401) on code head `d03b3ce`
> Result: 99 / 107 non-UI V1 capabilities verified; 8 retained as implemented with bounded gaps.

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
| Verified | 99 |
| Blocked by a bounded gap | 8 |
| Missing audit record | 0 |

The ten blocked capabilities are:

| Capability | Gap | Follow-up |
| --- | --- | --- |
| CHANGE-004 | Branch creation from an arbitrary historical node is not proven. | #263 |
| CHANGE-005 | The five-object comparison matrix is not proven. | #263 |
| CHANGE-006 | Per-object accept/reject/apply across all five object types is not proven. | #263 |
| CHANGE-007 | High-risk confirmation rejection paths are not proven. | #263 |
| EVAL-002 | The release-level inter-rater variance threshold is not approved. | #240 |
| EVAL-003 | The protected real DeepSeek smoke has not run for the release candidate. | #241 |
| EVAL-004 | Canary/rollback tests pass, but release use still requires real-provider and approved quality evidence. | #241 |
| CONT-001 | Deterministic continuity evaluation passes, but real human blind review is absent. | #239 |

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
  release-gate rejection tests.

The exact path for every capability and evidence item is in the machine-readable ledger.

## 4. Verification

```powershell
pnpm exec vitest run scripts/test/v1-capability-evidence.test.mjs scripts/test/v1-release-gate.test.mjs
node scripts/validate-readiness.mjs
pnpm release:check
```

Expected release result after this audit:

```text
V1 RELEASE BLOCKED
- capability-verification:17
  CHANGE-004..CHANGE-007, UI-001..UI-009, EVAL-002..EVAL-004, CONT-001
```

The remaining non-UI blockers are tracked by #239, #240, #241 and #263. UI capability
closure remains #238; final release evidence and CI remain #242.
