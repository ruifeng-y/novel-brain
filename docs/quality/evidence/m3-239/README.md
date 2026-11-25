# M3-239 Human Blind Review Evidence

This directory contains the frozen packet and real reviewer records for Issue #239.

- `packet.json`: reviewer-facing frozen sample packet.
- `key.json`: internal mapping from blind sample ids to dataset sample ids.
- `reviewer-XX-questionnaire.md`: completed, signed reviewer questionnaire.
- `reviewer-XX-scores.csv`: 408 raw scores per reviewer.
- `reviewer-XX-notes.json`: reviewer attestation and retained concerns.
- `human-scores.json`: 816 evaluator-compatible `human_blind` score records.
- `validation.json`: machine-readable structural and quality-gate result.
- `validation.md`: human-readable validation result.
- `validate-review.mjs`: deterministic validation and normalization command.

Run verification from the repository root:

```powershell
node .\docs\quality\evidence\m3-239\validate-review.mjs
```

The frozen packet contains synthetic benchmark samples only. It does not contain private
manuscript, prompts or context packs. The review records do not approve an inter-rater
variance threshold.
