# V1 固定质量基准 Registry 与回归门禁

> Owner: M3 #103 / #139
> Status: implementation baseline; release claims require real human evidence and approved variance threshold.

## Dataset

- 180 synthetic chapter samples，仙侠/历史/都市各 60。
- Easy/medium/hard 三档难度各占三分之一。
- 24 个 long-horizon adversarial cases 来自 #138 pinned fixture。
- Manifest pins sample id, source version/hash, genre, difficulty, known issues, fixture hash and dataset SHA-256.

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

## Run and gate

- A run records code/model/prompt/context/agent versions, every sample score, scorer id/type, confidence, evidence quote, decisions and continuity evaluation.
- Human-required dimensions accept only `human_blind` scores. Model-assisted scores never satisfy the gate.
- The deterministic P0, knowledge and continuity metrics are recomputed from the #138 evaluator artifact, not copied from caller-provided aggregate values.
- Baseline and candidate runs must share dataset and rubric hashes.
- Candidate release failure, invalid report digest, dataset/rubric mismatch or P0 regression blocks rollout.

## Release boundary

File-backed registry and CLI evidence prove benchmark implementation and gate mechanics. They do not prove that actual human blind review occurred. Real review records and the approved inter-rater variance threshold remain mandatory before a V1 release claim.
