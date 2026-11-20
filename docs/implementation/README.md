# Implementation entry point

> Status: implementation is authorized by the accepted baseline. Start with the first unblocked M0 ticket. This document governs engineering execution; it does not replace product requirements, ADRs, technical contracts or ticket acceptance criteria.

## 1. What is ready now

The repository contains product/technical documentation, accepted ADRs, a signed-off static prototype, and integrated M0–M2 production Web/API/Worker source. M0 closeout evidence is recorded in `docs/implementation/m0-13-m0-closeout.md`; M2 final integration and visual evidence are recorded by PR #185 and the M2 implementation reports.

- M0 parent spec: #66; leaf implementation tickets: #67–#79.
- M1 parent spec: #80; package/integration issues: #84–#90; leaf issues: #106–#119 and #141–#148.
- M2 parent spec: #81; package/integration issues: #91–#97; leaf issues: #120–#128 and #149–#152.
- M3 parent spec: #82; package/integration issues: #98–#104; leaf issues: #129–#140.
- Ticket map: `docs/planning/m1-m3-ticket-map.md`.
- Machine-readable dependency graph: `docs/planning/v1-issue-dependency-graph.json`.
- Capability-to-ticket ledger: `docs/planning/v1-capability-traceability.md`.
- UI page ownership/evidence: `docs/ui/v1-ui-parity-matrix.md`.
- Retro and immediate frontier: `docs/implementation/m2-retro.md`, `docs/planning/m1-tracker-reconciliation.md` and `docs/planning/implementation-frontier.md`.
- Agent delivery retro after #142: `docs/implementation/m1-142-retro.md`.
- Long-horizon continuity benchmark: `docs/implementation/m3-05b-continuity-benchmark.md`.
- Fixed quality benchmark registry: `docs/implementation/m3-06a-quality-benchmark-registry.md`.
- Provider smoke, canary and rollback strategy: `docs/implementation/m3-06b-provider-canary.md`.
- V1 UI/release closeout and final checklist: `docs/implementation/m3-104-v1-closeout.md`, `docs/implementation/v1-release-checklist.md`.

M1/M2/M3 package parents are not single /implement tasks: #84–#89, #91, #93–#96 and #98–#103. Implement their bounded child issues first, then close each parent with integration evidence. #90, #97 and #104 are integration/release gates. The new leaf issues are mapped, not automatically ready or verified. Never infer readiness from labels alone.

## 2. First command

After checking out the branch you intend to develop on and ensuring the repository is clean, invoke:

    /implement #67

Ticket title: **[M0-01] 工程骨架与健康探针**

The skill contract is:
1. Fetch the referenced issue and state its title before implementation.
2. Implement only the ticket's agreed scope.
3. Use the tdd skill at pre-agreed public seams where possible.
4. Run typechecking and focused tests regularly; run the full relevant suite at the end.
5. Run the code-review skill and resolve findings.
6. Commit the completed work to the current branch.

The issue tracker is GitHub in this repository. Use gh from the repository clone as described in docs/agents/issue-tracker.md.

## 3. M0 dependency graph

Only #67 is the initial frontier. A ticket is startable only after every listed blocker is complete and merged into the implementation branch.

| Ticket | Scope | Blocked by |
| --- | --- | --- |
| #67 | Monorepo skeleton, Compose, health, shared contracts, fake provider | — |
| #68 | Email auth, sessions, CSRF | #67 |
| #69 | BYOK DeepSeek config, encryption, provider allowlist | #67 |
| #70 | Works, dashboard, overview, main branch creation | #67, #68 |
| #71 | Partial/complete settings import and conflict resolution | #70 |
| #72 | Manuscript text import and chapter splitting | #70 |
| #73 | Story Bible nine cards, proposal/edit/lock | #70 |
| #74 | Minimal settings and confirmed-settings projection | #73 |
| #75 | Chapter brief, editor workspace, chapter versions | #73, #74 |
| #76 | Single chapter generation job, context compilation, trace/checkpoint | #69, #74, #75 |
| #77 | Fact proposals and per-fact decisions | #76 |
| #78 | Chapter approval and story-fact submission | #75, #77 |
| #79 | M0 full E2E, security, UI parity and real-provider evidence | #68–#78 |

Independent frontier tickets may run in parallel only when they share no mutable contract or schema under active change. If a shared contract is needed, serialize the work or agree the contract first. Integrate each completed ticket before starting dependent work.

## 4. Ticket completion contract

- [ ] Implementation matches the issue acceptance criteria and capability IDs.
- [ ] Relevant accepted ADRs and technical contracts are followed.
- [ ] Zod/OpenAPI contracts are shared across Web/API/Worker; no duplicate hand-written DTO.
- [ ] Database migrations are additive, reversible where practical, and tested against PostgreSQL.
- [ ] Authorization and tenant isolation are tested at the public API boundary.
- [ ] Worker jobs are typed, idempotent, checkpointed and recoverable where applicable.
- [ ] AI tests use deterministic fake providers; real-provider tests are separate, explicitly gated smoke/evaluation runs.
- [ ] UI work references its parity-matrix row, implements required states, and uses real API/Worker actions.
- [ ] Playwright covers primary behavior, gates, errors and responsive viewports required by the ticket.
- [ ] Focused tests, typecheck, lint/format and relevant full test suite pass.
- [ ] Code review has been run and all blocking findings are resolved.
- [ ] Evidence is recorded in the issue or implementation report; no criterion is silently waived.

## 5. Cross-cutting invariants

1. One version graph: no competing authoritative parent chains for chapter versions, canon commits, branches or snapshots.
2. Three separate editorial transitions: fact decision, chapter approval and story-fact submission are distinct; only the final gated submission changes authoritative confirmed settings.
3. Durable orchestration: Postgres owns job state and checkpoints; Redis/BullMQ transports work. Retries are idempotent and resume from the failed step.
4. Bounded agents: agents receive explicit task scope, tools, budget and permission. They cannot grant permissions, widen scope or commit canon directly.
5. Continuity before prose: generation receives versioned, source-cited context; objective story facts and per-character knowledge/belief/suspicion remain distinct.
6. Long-work retrieval: structured facts and state projections are authoritative; summaries and search indexes are derived, versioned and rebuildable.
7. No fake production behavior: fake providers are test seams only. UI demo controls and static prototype data do not satisfy production acceptance.
8. 10M is outside the V1 release claim after the explicit #102/#137 deferral. A future release may claim it only by reopening the benchmark and recording load/recovery evidence.
9. Long-horizon continuity is a separate release claim: #138 must test ground-truth state and knowledge boundaries over 3,000–4,000 chapters; a capacity benchmark cannot substitute for it.

## 6. M1–M3 implementation readiness gate

Issues #80–#82 remain milestone specification parents. The package/leaf structure and sequence are maintained in `docs/planning/m1-m3-ticket-map.md`; blocker edges are maintained in `docs/planning/v1-issue-dependency-graph.json` and repeated in issue bodies.

Before starting any leaf ticket:
- check every blocker named in the issue body and dependency graph;
- confirm its unique primary capability mapping in the traceability ledger;
- inspect the affected UI parity rows and contracts;
- agree schema/API ownership before parallel work;
- stop on unresolved product or ADR conflicts.

The graph validator is run from the repository root:

    node scripts/validate-readiness.mjs

The same command is enforced by `.github/workflows/readiness-validation.yml` for pull requests and relevant branch updates. It validates capability/UI/dependency contracts, including committed Golden artifact dimensions; release certification remains the separate `pnpm release:check` gate.

The dependency graph is normative together with each issue's Dependencies section. GitHub native dependency edges are not assumed to exist. A milestone is not implementation-ready merely because child tickets exist: blockers must close, shared contracts must be integrated and tests/evidence must pass.

The capability ledger contains **119 IDs**: the 117 original manifest entries plus PERF-001 (10M capacity/recovery) and CONT-001 (long-horizon continuity). AGENT-007 vector retrieval and QUALITY-009 real-reader feedback remain explicitly post-V1/deferred.

## 7. UI parity and prototype evidence

The signed-off prototype contains 18 screens: 17 production page contracts plus one prototype-only states gallery. All 17 production pages have owner Playwright specs and four viewport production Golden artifacts; `auth`, `help`, `legal`, dashboard, new-project, work-overview, bible, settings, outline and foreshadows are currently `parity-verified`. The other 7 non-static pages stay `production-built` until per-action API/persistence evidence and final normal PR CI pass. V1 release approval depends on `v1-release-checklist.md`.

Release-only UI checks are split across `docs/ui/v1-ui-deviations.json` for recorded product-owner deviations, `docs/ui/v1-action-contract.json` for the required action IDs, and `docs/implementation/v1-action-evidence.json` for per-action API/persistence evidence. Pending entries intentionally block `pnpm release:check`.

Prototype regression remains independently runnable from prototype/:

    cd prototype
    pnpm install --frozen-lockfile
    pnpm exec playwright install chromium
    pnpm test:parity

The prototype suite is not a substitute for production Web/API/Worker or production screenshot-parity tests. Production page owners, Playwright spec paths, four viewport sizes and golden artifact locations are registered in docs/ui/v1-ui-parity-matrix.md. M0 golden images are committed under `artifacts/ui/golden/` after author approval; future pages must follow the same process, and prototype images must not be copied into the production golden folder. Follow `docs/ui/production-visual-regression.md` and ADR 0027 for pinned rendering, 0.5% pixel tolerance, deterministic fixtures, CI diff artifacts and baseline approval.

## 8. Scale and quality gates

- #137 / `docs/performance/v1-10m-capacity-benchmark.md`: explicitly deferred outside V1; resuming the claim requires a deterministic 10,000,000-character fixture, mixed workload, p50/p95/p99 measurements, storage/index growth, job recovery and backup/restore.
- #138 / `docs/quality/v1-long-horizon-continuity-benchmark.md`: 3,000–4,000 chapter / 30–40 volume continuity ground truth, character knowledge boundaries, state invariants, plot/foreshadow checks and human blind review.
- #139 / `docs/quality/v1-quality-benchmark-registry.md`: frozen three-genre dataset, ADR 0022 release rubric, raw scorer evidence, P0 regression gate and CLI exit status.

Existing p95/streaming/SSE/RPO/RTO targets are taken from the technical baseline. Numeric p99, concurrent-user, storage-headroom and selected reviewer-agreement thresholds remain decision-required until formally approved; do not invent pass values.

## 9. Commands and evidence

Ticket #67 establishes the production workspace commands:

```bash
pnpm install
pnpm stack:up
pnpm test
pnpm test:integration
pnpm check
pnpm stack:smoke
pnpm --filter @novel-brain/api openapi:generate
```

The local Compose stack includes Caddy, Web, API, Worker, Postgres, Redis, Mailpit and a one-shot deterministic fake AI smoke service. `pnpm test` runs unit, contract and guardrail tests; `pnpm test:integration` runs HTTP integration tests against dedicated PostgreSQL/Redis test databases; `pnpm check` runs format, lint, typecheck, fixed-range PR guardrails, migration catalog/drift checks and the full unit suite; `pnpm stack:smoke` verifies the running services and the active Worker queue consumer. The API generates OpenAPI from NestJS Swagger while sourcing response schemas from the shared Zod contracts, then derives TypeScript types. Root developer instructions live in `README.md`; M0 evidence is recorded under `docs/implementation/`.
