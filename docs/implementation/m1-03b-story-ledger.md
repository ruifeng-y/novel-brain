# M1-03b 剧情线、伏笔与人物弧账本

> Ticket: #146  
> Capabilities: ONBOARD-006, PLAN-004  
> Status: implementation complete, author visual sign-off pending

## Delivered

- `plot_threads`, `foreshadows`, `character_arcs` are branch-scoped, tenant-owned tables with forced RLS.
- Every create, edit, lifecycle transition and soft delete appends a `ledger_version` node and an audit record.
- Lifecycle supports setup, progress, payoff, failed payoff, abandonment and deferral. Setup/payoff/abandonment require a source chapter or event and reason; payoff requires evidence.
- Deterministic checks cover overdue, duplicate, premature, weak, unsupported, invalidated and no-causal payoffs through `story-ledger-checks-v1`.
- CRUD workspace API is exposed at `/api/v1/works/:workId/branches/:branchId/ledger`.
- `/workspace/[workId]/foreshadows` provides real create/edit/lifecycle actions, filters, author-facing risk messages and lifecycle evidence.
- The outline workspace includes a 剧情账本 view linked to the full ledger page.

## Evidence

- Contracts: `packages/contracts/test/story-ledger.test.ts`
- Pure checks and transitions: `packages/core/test/story-ledger.test.ts`
- API, RLS and branch isolation: `apps/api/test/story-ledger.integration.test.ts`
- Four-viewport production E2E and author language: `apps/web/e2e/parity/foreshadows.spec.ts`
- Migration: `packages/db/migrations/0033_naive_young_avengers.sql`

The E2E suite uses a dedicated `novelbrain_e2e_146_*` database and an isolated Redis DB. Screenshot attachments are captured at 390/900/1180/1440; production goldens still require author approval.
