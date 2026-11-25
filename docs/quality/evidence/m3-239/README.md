# M3-239 Human Blind Review Evidence

This directory contains the frozen packet and reviewer records for Issue #239. The review
record is complete-with-warnings: all raw scores are recorded, while clean blind-review
and quality approval remain blocked.

- `packet.json`: reviewer-facing frozen sample packet.
- `key.json`: internal mapping from blind sample ids to dataset sample ids.
- `reviewer-XX-questionnaire.md`: completed, signed reviewer questionnaire.
- `reviewer-XX-scores.csv`: 408 raw scores per reviewer.
- `reviewer-XX-notes.json`: reviewer attestation and retained concerns.
- `human-scores.json`: 816 evaluator-compatible `human_blind` score records.
- `validation.json`: machine-readable technical, adjudication and quality-gate result.
- `validation.md`: human-readable validation result.
- `adjudication.template.json`: pending decisions for the 24 samples flagged by both reviewers.
- `validate-review.mjs`: deterministic validation and normalization command.

Run verification from the repository root:

```powershell
node .\docs\quality\evidence\m3-239\validate-review.mjs
node .\docs\quality\evidence\m3-239\validate-review.mjs --check-files
node .\docs\quality\evidence\m3-239\validate-review.mjs --check
```

`--check-files` verifies that generated files still match the raw inputs. `--check` also
enforces record integrity and exits successfully for `complete-with-warnings`; the separate
`qualityGate` remains blocked by oracle content, adjudication and rubric results.

The frozen packet contains synthetic benchmark samples only. It does not contain private
manuscript, prompts or context packs. The review records do not approve an inter-rater
variance threshold.

The `91b3...` value is the evaluator's dataset/rubric gate hash. `validation.json` also
records the actual `packet.json` file hash and canonical sample hash.

The packet schema has no oracle fields, but 24 frozen adversarial sample texts contain
explicit continuity-conflict metadata. `validation.json` records those sample ids as a
blind-packet warning and quality-gate blocker.
