# M1-05e 分层摘要、失效传播与索引重建

> Issue: #113  
> Capability: AGENT-008  
> Branch: `codex/m1-113`

## Delivered

- Added `summary_records` for chapter, stage (act), volume and book summaries.
- Summaries are rebuildable projections only. Canonical facts and chapter versions remain authoritative.
- Each summary retains `sourceRanges` with outline/chapter/version-node references, compiler version, model version, input hash and content hash.
- Added `summary_rebuild_runs` and `summary_rebuild_items` as durable checkpoint state. Redis/BullMQ only transports the typed `rebuild_summaries` job.
- Added `GET /works/:workId/branches/:branchId/summaries`, `POST /summaries/rebuild` and `GET /summaries/rebuilds/:runId`.
- Generation context includes only fresh summaries that end before the current chapter. Stale or rebuilding summaries are evicted as `summary_stale`.

## Invalidation rule v1

Implemented in `0036_summaries.sql`, with the pure dependency calculation in `packages/core/src/summary.ts`.

- Chapter version, fact or canon commit change: invalidate the chapter summary and its outline ancestors.
- Outline node change: invalidate the changed node, its descendants and its ancestors.
- Branch merge, rollback or change apply: invalidate every summary in that branch.
- Unrelated sibling subtrees and other branches remain fresh.

## Rebuild invariants

- Items are ordered leaf-first (`chapter → stage → volume → book`) and persisted before work starts.
- Each committed item increments the run checkpoint revision.
- A crashed worker resumes from the first non-succeeded item; repeated execution does not duplicate summaries.
- Unchanged source hashes keep the existing summary version; changed inputs create the next version.
- Reusing an idempotency key returns the original run.

## Evidence

- Contracts: `packages/contracts/test/summaries.test.ts`
- Invalidation rule: `packages/core/test/summary-invalidation.test.ts`
- Context exclusion: `packages/core/test/context-compiler.test.ts`
- API/Worker/RLS integration: `apps/api/test/summaries.integration.test.ts`
  - dedicated `novelbrain_test_113_<random>` database and isolated Redis DB
  - multi-volume, multi-chapter fixture
  - ancestor-only chapter invalidation, branch isolation, crash resume and idempotent replay

## Out of scope

- Full-text search index lifecycle (#128)
- Autonomous narrative revision
