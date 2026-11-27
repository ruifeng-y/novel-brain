# CONT-001 V1 延期决定

> Decision owner: product-owner
> Approved: 2026-11-27
> Supersedes: #278 clean-packet rebuild and #279 full rerun as V1 deliverables

## Decision

`CONT-001` is deferred outside the V1 release claim. V1 does not claim a clean 204-sample
long-horizon quality benchmark, a frozen replacement packet, or a new two-reviewer rerun.

This is an explicit product scope decision recorded in
`docs/planning/v1-deferrals.json` and ADR 0028. It is not a claim that the missing benchmark
evidence was completed.

## Retained Evidence

- #239 retains the historical human raw scores as `complete-with-warnings`.
- #273 retains the 24/24 product-owner replacement decisions and external attestation.
- The old 816 scores remain `invalidated_for_clean_review`.
- `hook_prose_score = 1.882353` remains below the `4/5` rubric threshold.
- No clean replacement packet was frozen and no `24/24` human replacement approval exists.
- #278 was closed as `NOT_PLANNED`; #279 is closed as `NOT_PLANNED` with this decision.

## Future Restart Boundary

Resuming the long-horizon quality claim requires a new explicit product decision, a new bounded
issue, a clean and approved packet, the pinned rubric and #240 variance policy `0.1`, and a
complete human rerun. The closed #278/#279 work cannot be cited as passed evidence.

## Machine Ledgers

- `docs/planning/v1-deferrals.json`
- `docs/planning/v1-capability-manifest.md`
- `docs/planning/v1-capability-traceability.md`
- `docs/implementation/v1-release-checklist.md`
- `docs/implementation/v1-release-evidence.json`
