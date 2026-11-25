# V1 固定质量基准 Registry 与回归门禁

> Owner: M3 #103 / #139
> Status: #239 raw-score capture is `complete-with-warnings`; #240 approves the variance threshold at `0.1`. #273 has prepared a non-approved cleanup proposal and a 24-sample human decision request, while clean blind review and quality claims remain blocked by pending adjudication and the observed hook/prose score.

## Dataset

- 180 synthetic chapter samples，仙侠/历史/都市各 60。
- Easy/medium/hard 三档难度各占三分之一。
- 24 个 long-horizon adversarial cases 来自 #138 pinned fixture。
- Manifest pins sample id, source version/hash, genre, difficulty, known issues, fixture hash and dataset SHA-256.
- Each sample pins the required outline beats used to validate blind-review evidence.

The complete frozen dataset is `docs/quality/quality-benchmark-v1.dataset.json`; its manifest is `docs/quality/quality-benchmark-v1.manifest.json`.

## Rubric

| Dimension | Initial approved threshold | Scorer |
| --- | --- | --- |
| P0 fact loss | exactly 0 | deterministic |
| Knowledge-boundary violation | exactly 0 | deterministic |
| Outline adherence | at least 0.9 | human blind |
| Hook/prose | at least 4/5 | human blind |
| Continuity conflicts | at most 1 per 50,000 characters | deterministic |

`docs/quality/quality-benchmark-v1.rubric.json` is the frozen rubric snapshot. A changed threshold requires a new approved decision/ADR and a new rubric version.
The rubric intentionally contains `reviewPolicy: null`; an inter-rater variance threshold is supplied only by the trusted evaluation boundary and is never inferred from candidate-reported decisions.

## Run and gate

- A run records code/model/prompt/context/agent versions plus `configHash`, every sample score, scorer id/type, confidence, evidence quotes, reviewer attestation, review timestamp, blind-packet hash, decisions and continuity evaluation.
- Human-required dimensions accept only `human_blind` scores. Model-assisted scores never satisfy the gate.
- Each human score must reference a consistent reviewer attestation, review timestamp and the frozen blind-packet hash. This records the review contract; it does not prove that a real person performed the review.
- The deterministic P0, knowledge and continuity metrics are recomputed from the pinned #138 fixture and the raw continuity findings retained in the run, not copied from caller-provided aggregate values.
- Continuity conflicts include both missed ground-truth defects and unexpected findings.
- Baseline and candidate reports must contain the five approved metrics exactly once, embed the approved dataset/rubric digests, and be reproducible from their embedded scores, raw continuity findings and fixture.
- Report and continuity evidence digests use canonical JSON so they remain stable after PostgreSQL `jsonb` key normalization.
- Baseline and candidate runs must share dataset and rubric hashes.
- The inter-rater variance policy is supplied separately by the trusted evaluation boundary; a threshold embedded inside a candidate or report never satisfies the decision gate.
- Candidate release failure, invalid or non-reproducible report, missing metric, identical baseline/candidate report, dataset/rubric mismatch or P0 regression blocks rollout.
- The persisted run key binds the complete candidate artifact, including provenance, scores, decisions and continuity findings. Reusing a `candidateId` with changed prompt/context/agent versions creates a distinct run.

## Persistence and module boundary

- Internal Nest `EvalModule` exposes `EvalService.run` and `EvalService.gate` for release orchestration.
- `eval_cases` stores frozen case metadata; `eval_runs`, `eval_scores` and `eval_gates` store tenant-scoped run evidence and rollout decisions. `eval_scores` also persists evidence quotes, reviewer attestation, review time and blind-packet hash for human scores.
- `eval_runs` retains raw continuity findings alongside the recomputable continuity evaluation for later audit.
- The three tenant tables force RLS. The curated `eval_cases` table is global and immutable for a dataset hash.
- Run/score/gate child rows use composite tenant foreign keys so they cannot reference another tenant's run even if RLS is bypassed during FK checks.
- The persistence integration test switches to a `NOSUPERUSER NOBYPASSRLS` role before asserting fail-closed tenant reads.
- This ticket does not add an unapproved external HTTP/UI contract; #140 can consume the service for provider smoke, canary and rollback.

## Release boundary

File-backed registry and CLI evidence prove benchmark implementation and gate mechanics. Issue #239 records two signed reviewer attestations, 816 raw `human_blind` scores, the evaluator gate hash and the actual reviewer-packet file/canonical hashes under `docs/quality/evidence/m3-239/` as `complete-with-warnings`.

The recorded result does not pass the V1 quality gate:

- `outline_adherence = 1.000000`, meeting the `>= 0.9` threshold.
- `hook_prose_score = 1.882353`, below the `>= 4` threshold.
- The observed max inter-rater variance is `0`. #240 approves the trusted review-policy
  threshold `0.1` in `docs/quality/evidence/m3-240/review-policy.json`; the observed result
  passes because `0 <= 0.1`.
- Both reviewers flagged the same 24 long-horizon cases for adjudication because the frozen text contains defect metadata rather than narrative prose. The raw-score evidence is complete, but clean blind review and adjudication are not.
- The packet schema excludes oracle fields, but the same 24 sample texts expose continuity-conflict metadata. A future clean blind review must remove that leakage or record an explicit product-owner resolution.
- #273 removes the explicit oracle annotation in a proposed 204-sample packet without deleting any sample. The proposal is not frozen and cannot be sent to reviewers until a real product/quality owner records the packet disposition, old-score impact and 24 sample adjudications.
- The #273 status ledger remains blocked with 0/24 adjudications. `hook_prose_score` has no approved remediation or waiver yet. The inter-rater variance threshold is approved as `0.1` under #240; observed `maxVariance = 0` passes it.

The V1 quality claim remains blocked until the human adjudication and packet disposition are recorded and the hook/prose quality failure is addressed. The threshold decision is complete and does not change the frozen rubric.
