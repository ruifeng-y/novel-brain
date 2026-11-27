# V1 Release Checklist

> Owner: M3-07 #104
> Status: **BLOCKED** - this checklist does not itself authorize a V1 release claim.
> Updated: 2026-11-27.

Machine-readable release evidence and waiver ownership live in `docs/implementation/v1-release-evidence.json`; authorized scope deferrals live in `docs/planning/v1-deferrals.json`; page deviations live in `docs/ui/v1-ui-deviations.json`; the required action IDs live in `docs/ui/v1-action-contract.json`; per-action API/persistence evidence lives in `docs/implementation/v1-action-evidence.json`. `pnpm release:check` rejects unknown gates, unregistered deferrals, empty local evidence, unsuccessful GitHub Actions runs, P0 failures, invalid waivers, unapproved deviations, pending action audits and any production page that is not release-approved.

## 1. Release scope decisions

- `PERF-001` / `#137` is explicitly deferred from the V1 capacity claim. V1 must not claim that 10,000,000-character capacity has been certified.
- `CONT-001` is explicitly deferred from V1 by product decision recorded on 2026-11-27. Historical #239/#273 evidence remains visible, but V1 makes no clean 204-sample human-review claim. #278 was closed `NOT_PLANNED`, no clean packet was frozen and no `24/24` replacement approval exists; #279 is not a V1 deliverable. The inter-rater variance threshold remains approved as `0.1` for any future restart.
- Real DeepSeek smoke passed manually in the protected `provider-smoke` GitHub environment. Ordinary CI still has no real-provider dependency.

## 2. Evidence ledger

| Gate | Evidence | Status |
| --- | --- | --- |
| Capability mapping | `docs/planning/v1-capability-manifest.md`, `docs/planning/v1-capability-traceability.md`, `docs/planning/v1-deferrals.json`, `docs/implementation/m3-cont-001-deferral.md`, `docs/implementation/m3-236-non-ui-capability-audit.md`, `docs/implementation/m3-236-non-ui-capability-evidence.json`, `docs/implementation/m3-238-ui-capability-evidence.json`, `docs/quality/evidence/m3-240/review-policy.json`; `node scripts/validate-readiness.mjs` | structure pass; 115/115 V1 capabilities and 106/106 non-UI capabilities verified; EVAL-002 is bound to Production CI `45944913873` at `e204faa`; CONT-001 is explicitly deferred |
| UI parity | `docs/ui/v1-ui-parity-matrix.md`, `docs/implementation/m3-238-ui-capability-evidence.json`; 17 production page specs; 68 required production Golden files at 390/900/1180/1440 | all 17 production pages are `parity-verified`; UI-001..UI-009 are verified; release-level evidence remains blocked |
| Visual regression | ADR 0027, `docs/ui/production-visual-regression.md`, Production CI `playwright`; 0.5% tolerance and retained diff artifacts | PR #281 `check`/`playwright` and Deployment Smoke passed at `e204faa`; the final release-evidence gate remains blocked pending a current-head evidence binding |
| Author language and prototype-only leakage | `expectAuthorFacingLanguage`, `expectNoPrototypeOnlyLeakage` across page parity specs | current UI capability evidence pass; PR #281 checks passed |
| Per-action API and persistence evidence | `docs/ui/v1-action-contract.json` + `docs/implementation/v1-action-evidence.json`; every required action must bind to its owner spec, `/api/v1/*` and persisted-result Playwright assertions | pass / no pending pages |
| Auth, password and session lifecycle | `docs/implementation/m0-02-email-auth-sessions.md`, `docs/implementation/m1-141-account-security.md`, `apps/web/e2e/parity/auth.spec.ts` | pass |
| Account export, deletion and purge | `docs/implementation/m3-03c-account-lifecycle.md`, tenant RLS audit and lifecycle integration tests | pass |
| Export, publish, reader preview and moderation | `docs/implementation/m3-01a-work-export.md`, `docs/implementation/m3-02a-publish-preview.md`, `docs/implementation/m3-02b-help-legal-moderation.md` | pass |
| Deployment, health, metrics and alerts | `docs/implementation/m3-04a-deployment-observability.md`; Deployment Smoke `compose-smoke` | pass |
| Backup, restore and retention | `docs/implementation/m3-04b-backup-restore.md`; backup/restore drill evidence | pass |
| Quality registry and deterministic regression | `docs/implementation/m3-06a-quality-benchmark-registry.md`; frozen dataset/rubric and P0 gate tests | pass |
| Real-provider smoke | `.github/workflows/provider-smoke.yml`; [protected manual run 45557765302](https://github.com/ruifeng-y/novel-brain/actions/runs/45557765302); `docs/implementation/evidence/m3-07e-01-provider-smoke-success-2026-11-25.json` | pass / DeepSeek official HTTPS API, `finishReason: stop`, 1 network call |
| Human blind review and variance threshold | `docs/implementation/m3-239-human-blind-review.md`, `docs/implementation/m3-240-variance-threshold.md`, `docs/implementation/m3-273-hidden-truth-adjudication.md`, `docs/implementation/m3-cont-001-deferral.md`, `docs/planning/v1-deferrals.json`, `docs/quality/evidence/m3-240/review-policy.json`, `docs/quality/evidence/m3-239/validation.json`, `docs/quality/evidence/m3-239/human-scores.json`, `docs/quality/evidence/m3-273/adjudication.json`, `docs/quality/evidence/m3-273/status.json` | historical record complete-with-warnings; threshold `0.1` approved; #273 records 24/24 replace decisions and external attestation; CONT-001 is deferred, so no clean V1 quality claim |
| 10M capacity | `#137` / `PERF-001` | explicitly deferred; excluded from V1 claims |
| Final #104 Production CI | Production CI `check`/`playwright` run [45944913873](https://github.com/ruifeng-y/novel-brain/actions/runs/45944913873); Deployment Smoke [45946581591](https://github.com/ruifeng-y/novel-brain/actions/runs/45946581591) | code-head evidence passed at `e204faa`; final release-evidence gate remains blocked |

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

1. Bind the final release-evidence gate to a current-head release CI run.
2. Bind current-head UI capability evidence to the same successful run; until then
   `capability-audit:verification-evidence-missing` remains.

Until then the release decision is **BLOCKED**, and no V1 clean long-horizon quality or capacity
claim may be made.
