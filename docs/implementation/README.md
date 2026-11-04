# Implementation entry point

> Status: implementation is authorized by the accepted baseline. Start with the first unblocked M0 ticket. This document governs engineering execution; it does not replace product requirements, ADRs, technical contracts or ticket acceptance criteria.

## 1. What is ready now
The repository currently contains product/technical documentation, accepted ADRs, a signed-off static prototype and Playwright prototype-parity tests. It does not yet contain the production Web/API/Worker application source. The first implementation unit is therefore the M0 walking skeleton, not a feature patch to the prototype.

- M0 parent spec: GitHub issue #66.
- M0 implementation tickets: #67–#79.
- M1 parent spec: #80.
- M2 parent spec: #81.
- M3 parent spec: #82.

M0 tickets have bounded scope and acceptance criteria. M1–M3 are milestone specifications, not single-ticket implementation units. Their implementation tickets must be decomposed and dependency-linked before those milestones are started. Do not pass #80, #81 or #82 to /implement as one giant task.

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
- [ ] code-review has been run and all blocking findings are resolved.
- [ ] Evidence is recorded in the issue or implementation report; no criterion is silently waived.

## 5. Cross-cutting invariants
1. One version graph: no competing authoritative parent chains for chapter versions, canon commits, branches or snapshots.
2. Three separate editorial transitions: fact decision, chapter approval and story-fact submission are distinct; only the final gated submission changes authoritative confirmed settings.
3. Durable orchestration: Postgres owns job state and checkpoints; Redis/BullMQ transports work. Retries are idempotent and resume from the failed step.
4. Bounded agents: agents receive explicit task scope, tools, budget and permission. They cannot grant permissions, widen scope or commit canon directly.
5. Continuity before prose: generation receives versioned, source-cited context; objective story facts and per-character knowledge/belief/suspicion remain distinct.
6. Long-work retrieval: structured facts and state projections are authoritative; summaries and search indexes are derived, versioned and rebuildable.
7. No fake production behavior: fake providers are test seams only. UI demo controls and static prototype data do not satisfy production acceptance.
8. 10M is a release claim, not an assumption: capacity must be demonstrated with the M3 fixture and recorded load/recovery evidence.

## 6. M1–M3 implementation readiness gate
Issues #80–#82 are parent specifications. Before /implement begins for each milestone:
- decompose the parent into bounded tickets by domain/workflow slice;
- assign every ticket exact capability IDs and parity-matrix page(s), or mark it explicitly backend-only;
- define file/package ownership where parallel implementation is planned;
- add blocking relationships so the ready frontier is unambiguous;
- ensure every ticket has observable acceptance criteria and test evidence;
- reconcile the ticket set against the capability manifest and traceability table.

A milestone is not implementation-ready while it has unmapped V1 capabilities, broad parent-only scope, unresolved cross-ticket contracts, or tickets marked ready despite open blockers.

## 7. Commands and evidence
The exact production workspace commands will be established by ticket #67 and recorded in root developer documentation. Until then, do not invent package scripts or claim the production stack is runnable.

Prototype regression remains independently runnable from prototype/:

    cd prototype
    pnpm install --frozen-lockfile
    pnpm exec playwright install chromium
    pnpm test:parity

The prototype test is not a substitute for production Web/API/Worker tests.