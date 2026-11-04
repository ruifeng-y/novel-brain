# V1 1000 万字容量、检索、并发与恢复基准

> Owner: M3 #102 (package) / #137 (implementation)
> Status: specification baseline; no capacity certification has been run.
> This benchmark verifies system capacity and recoverability. It does not measure narrative continuity or writing quality.

## 1. Objective and claim boundary

The V1 capacity claim is a single-work logical manuscript scale of **10,000,000 Chinese characters**, approximately 3,000–4,000 chapters across 30–40 volumes, with multiple branches and version history. The baseline is the approved local-first modular monolith, not an imagined horizontally scaled deployment.

A passing run must demonstrate the application against its integrated production schema, APIs, worker, indexes, object storage and backup/restore path. A synthetic toy schema or a prototype page is not acceptable evidence.

The following claims are kept separate:

- **Logical scale:** the full manuscript contains 10,000,000 source characters with the required chapter/volume distribution.
- **Physical capacity:** database, indexes, objects, WAL/temp files and backup artifacts fit the approved storage envelope.
- **Interactive performance:** read/edit/search/context operations meet approved SLOs at the measured load.
- **Background throughput:** imports, index rebuilds, batch generation and exports make bounded progress and recover after interruption.
- **Recoverability:** database and object storage can be restored consistently within measured recovery objectives.

## 2. Authoritative baseline and open decisions

| Dimension | Existing baseline | Benchmark treatment |
| --- | --- | --- |
| Host | 8 vCPU, 16 GB RAM, 100 GB SSD; single-machine Docker Compose | Pin exact CPU model, OS, filesystem, Docker/resource limits and disk type in every report |
| Worker | Global concurrency 4; per-work 2; per-user 2 | Test at configured limits and verify enforcement |
| Chapter | 2,500–3,500 characters; one chapter generation target ≤5 minutes | Record model/provider separately from non-model processing |
| Volume | 80–120 chapters; 100 chapters/volume may run overnight | Measure volume completion, queue wait and failure isolation |
| Long work | 3,000–4,000 chapters; 30–40 volumes; resume by volume | Verify partial progress and restart at chapter/step boundaries |
| CRUD | p95 <300 ms | Gate at p95; record p50 and p99 |
| Search | p95 <1 s | Gate at p95; record p50 and p99 |
| Streaming | First token <5 s | Separate provider wait from application/context preparation |
| SSE | Event delivery latency <1 s | Measure server enqueue to client receipt |
| Backup | Daily; RPO 24 h; RTO 4 h | Treat as targets until repeated drills measure them |

**Decision-required before release:** numeric p99 limits; API concurrency/session target; acceptable error and saturation rates; storage headroom within the 100 GB host; whether backup capacity is included in that disk envelope; restore dataset tier; and any latency allowance for large-version/branch comparisons. Do not invent these values in implementation tickets. Record the decision owner, rationale and approved threshold in the benchmark report.

## 3. Deterministic data fixture

### 3.1 Canonical fixture

The canonical fixture generator is deterministic by seed and should support at least these parameters:

- Logical manuscript size: exactly 10,000,000 Unicode code points in the authoritative manuscript text field. Report UTF-8 bytes separately; Chinese characters are not assumed to be one byte.
- Mid-range topology: 3,500 chapters / 35 volumes / 100 chapters per volume.
- Boundary topology: 4,000 chapters / 40 volumes, with a chapter-size distribution that totals 10,000,000 characters while respecting the specified 2,500–3,500 character range.
- Volume topology: configurable 80–120 chapters per volume; the generator must reject impossible parameter combinations rather than silently alter the target.
- Branch topology: main branch plus configurable parallel branches created at early, middle and late version nodes. Report branch count and divergence depth as fixture metadata; the approved V1 branch count is a decision required if not already fixed in an ADR.
- Version topology: immutable chapter versions, outline/settings versions, canon commits, snapshots, change applications, branch merges and rollback nodes using the single version graph.
- Derived data: context source references, layered summaries, search documents, alias records, timeline/fact/character edges and export receipts.
- Operational data: job/work-item/step attempts, checkpoints, cost reservations and audit entries. Secret values must be synthetic and excluded from artifacts.

The fixture generator must output a manifest containing seed, source commit, schema migration version, generator version, logical characters, UTF-8 manuscript bytes, chapter/volume counts, branch count, version-node counts, row counts per table, object counts and checksums.

### 3.2 Scale tiers

| Tier | Purpose | Data |
| --- | --- | --- |
| Smoke | Contract and CI sanity | Small fixture, deterministic and fast |
| Growth | Find index/query/storage growth behavior | 10%, 25%, 50% and 75% of canonical fixture |
| Full | Validate the published 10M claim | Full 10M-character fixture and target topology |
| Boundary | Verify upper chapter/volume cardinalities | 4,000 chapters / 40 volumes with 10M characters |
| Recovery | Exercise restore against a production-like image | Full fixture plus indexes, objects, branches and version graph |

The 10%/25%/50%/75% tiers are load-test progression steps, not separate product capacity claims.

## 4. Workload model

The harness must exercise the integrated application, not issue isolated database microbenchmarks only.

1. **Interactive read:** open work overview, chapter, chapter history, story bible, entity detail, timeline and branch head.
2. **Editing/write:** autosave manuscript blocks, save a formal revision, compare versions, update a structured setting and submit a canon commit.
3. **Search/retrieval:** Chinese title/body search, aliases, namesakes, historical version search where supported, structured relationship expansion and POV/branch filtering.
4. **Context compilation:** compile a chapter ContextPack using P0–P4 priority, source references, branch/version cutoff and character knowledge filtering.
5. **Batch orchestration:** create book/volume/chapter/step DAGs, run workers at the configured limits, pause, resume, cancel, retry and isolate a failed chapter.
6. **Branch/change:** create a branch from an old node, compare object state, compute impact and selectively merge a bounded set of objects.
7. **Import/index:** chunk a large manuscript import, resume after termination, update search indexes incrementally and rebuild indexes while reads continue.
8. **Export:** generate chapter/range/volume/full-book exports and version-pinned manifests asynchronously.
9. **SSE/notifications:** measure event delay, reconnect via event ID and avoid duplicate user-visible effects.
10. **Backup/restore:** snapshot Postgres and object storage consistently, corrupt/miss selected objects, restore in isolation and verify references.

Load scripts must declare the operation mix and concurrency profile in the run manifest. Use a ramp to discover saturation and then run a steady-state interval; the exact API-client concurrency and duration are decision-required and must not be presented as approved SLO until signed off.

## 5. Measurements

Capture raw samples and aggregate p50/p95/p99. Never report only averages.

| Area | Required measurements |
| --- | --- |
| API | Throughput, p50/p95/p99 per route class, error rate, timeout rate, response bytes |
| Database | Query latency, connection pool wait, lock wait, deadlocks, slow query plans, rows scanned, cache hit ratio, WAL growth |
| Search | Query latency, recall/precision on fixed corpus, index bytes, rebuild duration, write amplification |
| Context | Compile duration, source candidate count, selected/evicted count, token estimate, cache behavior |
| Worker | Queue depth/age, wait time, job throughput, active workers, retry count, checkpoint size, stuck jobs |
| Model | Provider wait, first-token latency, output duration, tokens, 429/retry and cost; report separately from app-only time |
| SSE | Event enqueue-to-client latency, reconnect time, duplicate/missing events |
| Host | CPU, RSS, peak RAM, disk used/free, IOPS, throughput, disk latency, network |
| Storage | Database bytes, index bytes, object bytes, version/history bytes, backup bytes, temporary/export bytes |
| Recovery | RPO observed, restore wall time, verification time, lost/replayed work and post-restore integrity |

## 6. Execution plan

1. Pin the source commit, migration set, seed, generator version, provider mode and host manifest.
2. Run fixture generation and verify its counts/checksums before starting load.
3. Run migrations and index builds on an empty database, record cold-build durations, then verify counts.
4. Run smoke and growth tiers; inspect query plans and memory/disk growth before full tier.
5. Run the full interactive workload with workers disabled to isolate API/database/search behavior.
6. Run background workers at global/per-work/per-user configured concurrency; include chapter generation with deterministic fake provider and a separately gated real-provider sample.
7. Run index rebuild while interactive reads/writes continue; measure freshness lag and query impact.
8. Run large import/export and branch comparison while recording temporary disk usage.
9. Kill API/worker processes at selected job-step boundaries; verify checkpoints, idempotency and queue recovery.
10. Take a full backup, restore into a clean isolated host, verify database rows and object checksums, then record actual RPO/RTO.
11. Repeat critical runs to identify variance. Retain raw results; do not select only the best run.

## 7. Failure injection

Required scenarios include: worker termination before/after checkpoint commit; API restart during SSE; Redis/BullMQ outage; Postgres restart; slow query/connection exhaustion; provider timeout/429; disk pressure; interrupted import; interrupted index build; missing/corrupt object; partial backup; interrupted restore; stale branch head during compare/apply; duplicate job events; and retry races.

Expected behavior is fail-closed where data integrity or authorization is involved, checkpointed where work can resume, and explicit to the author where a task is paused or partially failed.

## 8. Pass/fail and release evidence

- Existing p95 and timing targets in section 2 must be met on the pinned baseline, or a formally approved deviation is recorded.
- p99, request concurrency, failure-rate, disk-headroom and other unapproved limits remain **decision-required** until signed off; a report may expose measurements but cannot silently invent pass thresholds.
- No silent data loss, duplicate canon commits, duplicate charges or cross-tenant leakage is permitted.
- Index rebuild and imports must be resumable and must not invalidate authoritative source data.
- Full fixture + backup/restore must pass integrity checks before any 10M-ready statement.
- A failed metric produces an issue with reproduction, raw trace, query plan/resource evidence and an owner. A waiver records approver, rationale, impact and expiry.
- Certification is scoped to the exact commit, schema, host, fixture manifest and workload manifest. It does not automatically apply to a different deployment.

Required report artifacts: environment manifest, source commit, fixture manifest, scripts, raw measurements, summary charts/tables, query plans, failure-injection log, backup/restore checksums, target comparison and signed release decision.

## 9. Out of scope

This benchmark does not prove plot coherence, fact correctness, character knowledge boundaries, literary quality, multi-tenant scale beyond the approved host, cloud horizontal scaling or real-provider throughput beyond the explicitly sampled provider run. See docs/quality/v1-long-horizon-continuity-benchmark.md and #138.
