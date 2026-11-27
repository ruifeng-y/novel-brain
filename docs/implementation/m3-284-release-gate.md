# M3-07f-03 Final Release Evidence Gate

> Issue: #284
> Parent: #104
> Status: release-evidence wiring updated; final gate remains explicitly blocked

## Context

PR #283 verified `EVAL-002` and removed its stale gap, but `pnpm release:check` still reports:

```text
release-evidence:status-blocked
final-production-ci:blocked
capability-audit:verification-evidence-missing
```

The last capability-audit blocker is current-head UI evidence. Deployment Smoke did not run on
release-evidence-only pull requests because its path filter only covered application, package,
infrastructure, and selected deployment scripts.

## Change

`deployment-smoke.yml` now treats the following as deployment-relevant pull-request changes:

- `scripts/validate-v1-release.mjs`
- `scripts/v1-capability-evidence.mjs`
- `docs/implementation/v1-release-evidence.json`
- `docs/implementation/v1-release-checklist.md`

A release-evidence PR now triggers Deployment Smoke alongside Production CI and Readiness on the
same pull-request head.

## Current Evidence

PR #285 passed Production CI `45954872224`, Readiness `45954872160`, and Deployment Smoke
`45954872263` on head `50d2747`. `pnpm release:check` now reports only:

```text
release-evidence:status-blocked
final-production-ci:blocked
```

## Boundary

This does not fabricate the final gate. A successful PR run must still be bound to the final
evidence head; if that binding cannot be made without changing the head, `#104` remains OPEN and
the exact blocker stays visible.
