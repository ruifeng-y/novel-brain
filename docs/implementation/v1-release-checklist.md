# V1 Release Checklist

> Owner: M3-07 #104
> Status: **BLOCKED** - this checklist does not itself authorize a V1 release claim.
> Updated: 2026-11-18.

Machine-readable release evidence and waiver ownership live in `docs/implementation/v1-release-evidence.json`; authorized scope deferrals live in `docs/planning/v1-deferrals.json`; page deviations live in `docs/ui/v1-ui-deviations.json`; the required action IDs live in `docs/ui/v1-action-contract.json`; per-action API/persistence evidence lives in `docs/implementation/v1-action-evidence.json`. `pnpm release:check` rejects unknown gates, unregistered deferrals, empty local evidence, unsuccessful GitHub Actions runs, P0 failures, invalid waivers, unapproved deviations, pending action audits and any production page that is not release-approved.

## 1. Release scope decisions

- `PERF-001` / `#137` is explicitly deferred from the V1 capacity claim. V1 must not claim that 10,000,000-character capacity has been certified.
- `CONT-001` deterministic long-horizon implementation is complete, but the narrative-quality claim remains blocked until real human blind review and an approved inter-rater threshold exist.
- Real DeepSeek smoke remains manual-only in the `provider-smoke` GitHub environment. Ordinary CI has no real-provider dependency.

## 2. Evidence ledger

| Gate | Evidence | Status |
| --- | --- | --- |
| Capability mapping | `docs/planning/v1-capability-manifest.md`, `docs/planning/v1-capability-traceability.md`; `node scripts/validate-readiness.mjs` | structure pass; UI release remains blocked |
| UI parity | `docs/ui/v1-ui-parity-matrix.md`; 17 production page specs; 76 production Golden files at 390/900/1180/1440 | blocked: `auth`, `help` and `legal` are `parity-verified`; 14 non-static pages remain `production-built`, with dashboard pending final normal PR CI |
| Visual regression | ADR 0027, `docs/ui/production-visual-regression.md`, Production CI `playwright`; 0.5% tolerance and retained diff artifacts | existing Golden baseline evidence pass; final normal PR CI pending |
| Author language and prototype-only leakage | `expectAuthorFacingLanguage`, `expectNoPrototypeOnlyLeakage` across page parity specs | implemented; final normal PR CI pending |
| Per-action API and persistence evidence | `docs/ui/v1-action-contract.json` + `docs/implementation/v1-action-evidence.json`; every required action must bind to its owner spec, `/api/v1/*` and persisted-result Playwright assertions | blocked / 13 pages pending |
| Auth, password and session lifecycle | `docs/implementation/m0-02-email-auth-sessions.md`, `docs/implementation/m1-141-account-security.md`, `apps/web/e2e/parity/auth.spec.ts` | pass |
| Account export, deletion and purge | `docs/implementation/m3-03c-account-lifecycle.md`, tenant RLS audit and lifecycle integration tests | pass |
| Export, publish, reader preview and moderation | `docs/implementation/m3-01a-work-export.md`, `docs/implementation/m3-02a-publish-preview.md`, `docs/implementation/m3-02b-help-legal-moderation.md` | pass |
| Deployment, health, metrics and alerts | `docs/implementation/m3-04a-deployment-observability.md`; Deployment Smoke `compose-smoke` | pass |
| Backup, restore and retention | `docs/implementation/m3-04b-backup-restore.md`; backup/restore drill evidence | pass |
| Quality registry and deterministic regression | `docs/implementation/m3-06a-quality-benchmark-registry.md`; frozen dataset/rubric and P0 gate tests | pass |
| Real-provider smoke | `.github/workflows/provider-smoke.yml`; requires explicit `provider-smoke` environment dispatch | blocked / evidence not run |
| Human blind review and variance threshold | `docs/quality/v1-quality-benchmark-registry.md`, `docs/quality/v1-long-horizon-continuity-benchmark.md` | blocked / no approved human evidence |
| 10M capacity | `#137` / `PERF-001` | explicitly deferred; excluded from V1 claims |
| Final #104 Production CI | `Production CI/check`, `Production CI/playwright`, `Deployment Smoke/compose-smoke` | blocked until the final release PR run is green |

The P0 ledger is `p0Failures: []`. Every waiver must include both an owner and rationale; an unchecked P0 or ownerless waiver blocks release.

## 3. Required commands

Run from the repository root with native PowerShell:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:guardrails
pnpm check:pr
pnpm check:migrations
pnpm exec vitest run --testTimeout 15000
pnpm exec vitest run scripts/test --testTimeout 15000
pnpm test:e2e
node scripts/validate-readiness.mjs
pnpm release:check
```

The real-provider gate must be run separately from GitHub Actions using the manual `provider-smoke` workflow and its protected environment secret.
`pnpm release:check` also requires an authenticated `gh` CLI because GitHub Actions evidence URLs are checked for completed successful runs.

## 4. Remaining blockers

1. Complete the capability-by-capability evidence audit and move applicable V1 traceability rows from `mapped`/`implemented` to `verified`; `pnpm release:check` currently reports 116 unresolved V1 capabilities.
2. Complete the per-action API/persistence audit for the remaining 13 non-static production pages and replace each pending action-evidence ledger entry with reproducible Playwright evidence.
3. Keep `help` parity status bound to the recorded Production CI run; rerun normal CI after any further help-page change.
4. Record actual human blind-review scores for the frozen quality packet.
5. Approve and record the inter-rater variance threshold with an owner and rationale.
6. Run the manual real-provider smoke against the approved commit/config and attach its redacted evidence.
7. Run the final #104 Production CI and update the `final-production-ci` evidence gate with the green run URL.

Until then the release decision is **BLOCKED**, and no V1 quality or capacity claim may be made.
