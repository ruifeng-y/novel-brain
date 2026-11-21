# M3-07c-01 Non-UI V1 Capability Evidence Audit

> Issue: #236
> Audited: 2026-11-21
> Machine-readable ledger: `docs/implementation/m3-236-non-ui-capability-evidence.json`
> Result: 101 / 107 non-UI V1 capabilities verified; 6 retained as implemented with bounded gaps.

## 1. Audit Rule

Each non-UI V1 capability must point to at least one executable contract, unit,
integration, E2E, benchmark or guardrail test. A documentation path alone cannot verify a
capability. Manual sign-off may support an executable test, but cannot replace it.

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
| Verified | 101 |
| Blocked by a bounded gap | 6 |
| Missing audit record | 0 |

The six blocked capabilities are:

| Capability | Gap | Follow-up |
| --- | --- | --- |
| WORK-002 | Large-file chunked import and interruption recovery are not proven. | #262 |
| IO-001 | TXT/Markdown work, but DOCX manuscript and settings import are still rejected. | #261 |
| IO-003 | No generated 10M-character, bounded-memory and crash-resume evidence. | #262 |
| EVAL-002 | The release-level inter-rater variance threshold is not approved. | #240 |
| EVAL-003 | The protected real DeepSeek smoke has not run for the release candidate. | #241 |
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
- capability-verification:15
  WORK-002, IO-001, IO-003, UI-001..UI-009, EVAL-002, EVAL-003, CONT-001
```

The remaining non-UI blockers are tracked by #240, #241, #261 and #262. UI capability
closure remains #238; final release evidence and CI remain #242.
