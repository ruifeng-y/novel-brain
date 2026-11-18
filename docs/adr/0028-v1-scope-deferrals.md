---
Status: accepted
---

# V1 scope deferrals are explicit and version-bound

## Context

ADR 0010 froze a 10,000,000-character V1 capacity target. The subsequent product decision recorded through #102/#137 removed that certification claim from V1 because no benchmark run exists. AGENT-007 vector retrieval and QUALITY-009 real-reader feedback were already retained as post-V1 capabilities. Leaving these exclusions in prose-only notes makes it possible for an unrelated capability to escape V1 by editing its ledger scope.

## Decision

- ADR 0010's 10,000,000-character capacity certification is superseded for V1. V1 makes no capacity certification claim.
- `PERF-001`, `AGENT-007` and `QUALITY-009` are the only capabilities currently authorized as post-V1 deferrals.
- Every authorized deferral must have a matching record in `docs/planning/v1-deferrals.json` with owner, date, rationale, scope/status and reproducible evidence.
- A capability cannot leave V1 by changing only the traceability row. An unregistered deferral fails the release gate.
- Deferred capabilities remain outside V1 release gates and must not be represented by fake, partial or prototype-only production behavior.
- Resuming any deferred capability requires a new explicit product decision, a new benchmark/acceptance plan where applicable, capability ownership and versioned implementation issues.

## Consequences

- V1 release checks can distinguish an authorized product deferral from an accidental or silent scope omission.
- A future capacity claim requires reopening `PERF-001` and completing the benchmark in `docs/performance/v1-10m-capacity-benchmark.md`.
- AGENT-007 and QUALITY-009 remain visible product direction without creating V1 acceptance work.
