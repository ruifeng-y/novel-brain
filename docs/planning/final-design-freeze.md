# Final Design Freeze

> Status: accepted baseline for V1 implementation.
> Date: 2026-11-04.
> Authority: accepted ADRs 0025–0027 plus the V1 requirements, technical design, UI parity matrix and post-V1 scope register.
> This document closes the five pre-implementation design issues; it is not a new product specification.

## 1. Five closure decisions

| # | Item | Frozen decision | Source of truth |
|---|---|---|---|
| 1 | UUID generation | Application server generates UUID v7; DB columns do not generate business IDs with gen_random_uuid() | docs/technical/m0-protocol-freeze.md, docs/technical/nestjs-backend-design.md |
| 2 | V1 retrieval | PostgreSQL structured/text search only (pg_trgm, simple tsvector, typed aliases/relations); no V1 embedding column, pgvector extension or HNSW index | docs/technical/nestjs-backend-design.md, ADR 0019 and Issues #112/#128 |
| 3 | Collaboration/economy scope | Same-chapter real-time collaboration and the full economy transaction engine are post-V1; V1 retains single-author work ownership and typed item/resource rights | ADR 0025, ADR 0026, docs/planning/post-v1-scope-register.md |
| 4 | Readiness validation | Static validator checks manifest/traceability parity, unique V1 capability ownership, 17 production UI rows, leaf owners, graph references/parents/duplicate edges/cycles; CI runs it on relevant changes | scripts/validate-readiness.mjs, .github/workflows/readiness-validation.yml |
| 5 | Production visual parity | 17 pages × 4 viewports; fixed browser/fonts/fixtures, 0.5% pixel-diff ceiling, retained diff artifacts, author-approved initial baselines and explicit deviation process | ADR 0027, docs/ui/production-visual-regression.md, docs/ui/v1-ui-parity-matrix.md |

## 2. V1 scope boundary

V1 remains the individual-author release defined by docs/requirements/v1-requirements.md. Post-V1 capabilities are recorded rather than silently dropped. They do not create V1 blocker edges, capability IDs or extra work before M0.

## 3. Design exit criteria

The design phase is closed when the following are true:

- [x] UUID generation ownership is unambiguous across API/Worker/database.
- [x] V1 search architecture has no contradictory vector schema/index requirement.
- [x] Real-time collaboration and full economy scope are explicitly retained but deferred.
- [x] The readiness validator is syntactically valid and has an automated CI entry point.
- [x] Production screenshot comparison has a deterministic environment, fixed viewports, numeric tolerance, artifact retention and author approval workflow.
- [x] The production page matrix remains the owner of all 17 V1 page contracts.
- [x] No additional global design review is required before starting M0 #67.

## 4. Implementation rules after freeze

- Start only the first unblocked leaf issue from docs/planning/implementation-frontier.md; current M0 frontier is #67.
- Do not reopen these decisions because an implementation preference changes. A genuine conflict requires a narrowly scoped ADR or issue.
- Do not add V1 product scope through implementation convenience. Post-V1 work requires explicit product planning.
- Do not claim the validator, production screenshot suite, 10M benchmark or long-horizon benchmark has passed until its real CI/runtime evidence exists.
- The static readiness workflow validates document and dependency structure only. It does not certify production code, page parity, capacity or narrative quality.
