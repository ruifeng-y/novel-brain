# M1-05d 结构化检索、实体图与别名召回

> Issue: #112  
> Branch: `codex/m1-112`  
> Integration base: `codex/m1-full-loop` at `e50e985`

## Delivered

- Added the shared `search_documents` index contract and migration `0034_parched_shocker.sql`. It is the single text/structured index for #112 and the future #128 search module; no pgvector, embedding column or HNSW index was introduced.
- Added `pg_trgm`, `simple tsvector`, tenant/chapter indexes and a GIN trigram index over the combined title/content/aliases expression.
- Added index-sync triggers for entity versions, facts, timeline events and map nodes. Existing rows are backfilled before RLS is forced.
- Added `POST /api/v1/works/:workId/branches/:branchId/retrieval/search`.
- Added hard filters for work, branch, version-node ancestry, chapter validity, story time and POV knowledge. Fact results require an active `knowledge` state when a POV is supplied; beliefs, suspicions, unknowns and future facts are excluded.
- Added typed relationship expansion through `character_relationships` and `faction_relationships`, including chapter/story-time validity, incoming/outgoing direction and relationship paths. Map nodes, items, factions, locations and timeline events are reachable as relationship targets.
- Added Chinese alias/synonym/fuzzy recall and same-name disambiguation metadata.
- Every result carries `source`, version-node/object version, chapter/story-time validity and source chapter where available.

## Shared contracts

- `retrievalQuerySchema`, `retrievalResultSchema`, `retrievalResultListResponseSchema`
- `searchDocumentSchema` and `searchDocumentSourceTypeSchema`
- `DomainRef` now accepts `world_rule`, matching the existing setting entity type.

## Evidence

- `pnpm check`: 24 files / 189 tests passed.
- Retrieval integration: `apps/api/test/retrieval.integration.test.ts` 6 tests passed, using `novelbrain_test_112_<random>` and an isolated Redis DB.
- Full integration: 17 files / 124 tests passed.
- `pnpm --filter @novel-brain/api openapi:generate`: OpenAPI and generated types updated.

### Query plans

Tenant-scoped recall uses the tenant/chapter btree:

```text
Index Scan using search_documents_user_work_branch_idx on search_documents
  Index Cond: user_id = ... AND work_id = ... AND branch_id = ...
  Filter: chapter validity + title/alias/content/substring/fuzzy predicates
```

Text recall across the shared index uses the trigram GIN index:

```text
Bitmap Heap Scan on search_documents
  Recheck Cond: lower(title || ' ' || content || ' ' || aliases::text) LIKE '%term%'
  -> Bitmap Index Scan on search_documents_trgm_idx
```

### Latency

Representative fixture: 10,000 indexed entity documents in one branch, 20 warm retrieval requests.

```text
PostgreSQL 16.15
retrieval large-work latency p95=160.7ms
```

The assertion records plan/index usage and a p95 budget of 1,500ms in the integration test.

## Residual risk

- Branch-scoped queries first narrow with tenant/chapter indexes, then apply fuzzy post-filters; the trigram index is proven for index-level text recall, but planner choice can vary with corpus size.
- Fuzzy thresholds (`similarity >= 0.2`, `word_similarity >= 0.33`) are tuned for two-character Chinese names and need corpus-level precision/recall tuning in #128.
- Migration backfill indexes all existing entity versions. Large production databases should validate backfill time in the #137 capacity window.
- #128 must extend the shared index to chapters/settings and own bulk rebuild/incremental progress; it should not create a second index table.
- Existing facts still store string subject/object rather than typed subject/object IDs, so facts are retrievable but cannot yet be used as graph-expansion seeds. Entity existence also has no chapter-validity column in the M1 schema; chapter/time hard filters apply to facts, events, map nodes and typed relationships.
