# M1 Tracker Reconciliation

> Date: 2026-11-12
> Baseline: `main@024e4ea`, PR #185
> Source evidence: `docs/implementation/m1-spec-closeout.md`, current production code, signed Linux Golden and Production CI #43202849140

## Closed Leaves

- #109, #110, #111, #113, #115: Agent Runtime, ContextPack, summaries and recovery
- #116, #117, #118: writing actions, quality critic and targeted revision
- #141: account profile, pen names, password recovery and session management
- #143: Story Bible and structured world rules
- #145, #146: five-level outline and story ledgers
- #149, #150: batch review queue and cost hard-stop/reporting

## Closed Parents

- #86: outline and story ledgers
- #88: Agent Runtime and continuity retrieval
- #91 and #93 were already closed by the final M2 integration.

## Remaining Code Blockers

- #162 and #165 block #147. The Golden Three flow must follow ADR 0007 and use real author-model ContextPack provenance before the parent can close.
- #166 blocks #144 and the affected world-domain/writing leaves #106, #107, #108 and #119. Generic setting PATCH must stop writing dedicated-domain data.
- #84, #85, #87 and #89 remain open until their blocked children close.
- #90 remains the M1 integration gate until #84–#89 and the review decisions are complete.

## Next Frontier

After this reconciliation, #132 is the first bounded security/release task:

- inventory every tenant-owned M0–M2 table;
- verify enabled and forced RLS plus policy ownership;
- add cross-tenant API/Worker/search/export coverage;
- fail closed when user context is missing;
- produce a machine-readable inventory that blocks release on uncovered tables.

## Rule

Do not close a leaf merely because an implementation document exists. Close it only when the current `main` code, acceptance tests and required visual/product evidence are present. Review/decision issues that identify a current contract defect remain blockers until fixed.
