# V1 Release Checklist

> Owner: M3-07 #104
> Status: **BLOCKED** - this checklist does not itself authorize a V1 release claim.
> Updated: 2026-11-26.

Machine-readable release evidence and waiver ownership live in `docs/implementation/v1-release-evidence.json`; authorized scope deferrals live in `docs/planning/v1-deferrals.json`; page deviations live in `docs/ui/v1-ui-deviations.json`; the required action IDs live in `docs/ui/v1-action-contract.json`; per-action API/persistence evidence lives in `docs/implementation/v1-action-evidence.json`. `pnpm release:check` rejects unknown gates, unregistered deferrals, empty local evidence, unsuccessful GitHub Actions runs, P0 failures, invalid waivers, unapproved deviations, pending action audits and any production page that is not release-approved.

## 1. Release scope decisions

- `PERF-001` / `#137` is explicitly deferred from the V1 capacity claim. V1 must not claim that 10,000,000-character capacity has been certified.
- `CONT-001` deterministic long-horizon implementation is complete and #239 records the human raw scores as `complete-with-warnings`. #273 records 24/24 product-owner replacement decisions, invalidates old scores for clean review and has an owner-authored external attestation. #278 has 24 oracle-free replacement candidates, a reproducible manifest and a 204-sample candidate packet, but `0/24` are human-approved and no packet is frozen. #279 owns corpus remediation and full 204-sample rerun. The V1 claim remains blocked by those follow-ups. The inter-rater variance threshold is approved as `0.1`.
- Real DeepSeek smoke passed manually in the protected `provider-smoke` GitHub environment. Ordinary CI still has no real-provider dependency.

## 2. Evidence ledger

| Gate | Evidence | Status |
| --- | --- | --- |
| Capability mapping | `docs/planning/v1-capability-manifest.md`, `docs/planning/v1-capability-traceability.md`, `docs/implementation/m3-236-non-ui-capability-audit.md`, `docs/implementation/m3-236-non-ui-capability-evidence.json`, `docs/implementation/m3-238-ui-capability-evidence.json`, `docs/quality/evidence/m3-240/review-policy.json`; `node scripts/validate-readiness.mjs` | structure pass; 114/116 V1 capabilities and 105/107 non-UI capabilities verified; EVAL-002 awaits final release-head CI through #242; CONT-001 retains a bounded gap |
| UI parity | `docs/ui/v1-ui-parity-matrix.md`, `docs/implementation/m3-238-ui-capability-evidence.json`; 17 production page specs; 68 required production Golden files at 390/900/1180/1440 | all 17 production pages are `parity-verified`; UI-001..UI-009 are verified; release-level evidence remains blocked |
| Visual regression | ADR 0027, `docs/ui/production-visual-regression.md`, Production CI `playwright`; 0.5% tolerance and retained diff artifacts | release gate requires current-HEAD normal PR Production CI, Deployment Smoke and Readiness; final #104 normal PR CI pending |
| Author language and prototype-only leakage | `expectAuthorFacingLanguage`, `expectNoPrototypeOnlyLeakage` across page parity specs | current UI capability evidence pass; final #104 normal PR CI pending |
| Per-action API and persistence evidence | `docs/ui/v1-action-contract.json` + `docs/implementation/v1-action-evidence.json`; every required action must bind to its owner spec, `/api/v1/*` and persisted-result Playwright assertions | pass / no pending pages |
| Auth, password and session lifecycle | `docs/implementation/m0-02-email-auth-sessions.md`, `docs/implementation/m1-141-account-security.md`, `apps/web/e2e/parity/auth.spec.ts` | pass |
| Account export, deletion and purge | `docs/implementation/m3-03c-account-lifecycle.md`, tenant RLS audit and lifecycle integration tests | pass |
| Export, publish, reader preview and moderation | `docs/implementation/m3-01a-work-export.md`, `docs/implementation/m3-02a-publish-preview.md`, `docs/implementation/m3-02b-help-legal-moderation.md` | pass |
| Deployment, health, metrics and alerts | `docs/implementation/m3-04a-deployment-observability.md`; Deployment Smoke `compose-smoke` | pass |
| Backup, restore and retention | `docs/implementation/m3-04b-backup-restore.md`; backup/restore drill evidence | pass |
| Quality registry and deterministic regression | `docs/implementation/m3-06a-quality-benchmark-registry.md`; frozen dataset/rubric and P0 gate tests | pass |
| Real-provider smoke | `.github/workflows/provider-smoke.yml`; [protected manual run 45557765302](https://github.com/ruifeng-y/novel-brain/actions/runs/45557765302); `docs/implementation/evidence/m3-07e-01-provider-smoke-success-2026-11-25.json` | pass / DeepSeek official HTTPS API, `finishReason: stop`, 1 network call |
| Human blind review and variance threshold | `docs/implementation/m3-239-human-blind-review.md`, `docs/implementation/m3-240-variance-threshold.md`, `docs/implementation/m3-273-hidden-truth-adjudication.md`, `docs/implementation/m3-278-clean-blind-packet.md`, `docs/quality/evidence/m3-240/review-policy.json`, `docs/quality/evidence/m3-239/validation.json`, `docs/quality/evidence/m3-239/human-scores.json`, `docs/quality/evidence/m3-273/adjudication.json`, `docs/quality/evidence/m3-273/status.json`, `docs/quality/evidence/m3-278/status.json`, `docs/quality/evidence/m3-278/replacement-manifest.json` | record complete-with-warnings; threshold `0.1` approved; #273 records 24/24 replace decisions; #278 candidates await `24/24` human approval and packet freeze; #279 remains pending |
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

1. Complete #278: approve all 24 replacement candidates, record external human attestation, then freeze the clean 204-sample packet.
2. Complete #279: benchmark corpus remediation and complete 204-sample two-reviewer rerun.
3. Complete final release-head verification (#242) and update `final-production-ci` with the green run URL.

Until then the release decision is **BLOCKED**, and no V1 quality or capacity claim may be made.
