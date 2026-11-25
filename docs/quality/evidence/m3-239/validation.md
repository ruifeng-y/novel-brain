# M3-239 人工盲评证据校验

> Structural status: **PASSED**
>
> Quality gate: **BLOCKED**

## Frozen evidence

- Dataset SHA-256: `90c8c8c44540ae99246e243ac16c1158d7cee3485ac4b5c1a901b3b7164e753b`
- Rubric SHA-256: `247a1fcc0c0ce58bca7faa8a93a8b0d0e39c4095fc2f1c5748767b53d6fc1b3b`
- Gate blind-packet SHA-256: `91b3c844070a69a4eea51d6583d816d5d732d9ccad95f972a2d6a77b0287c2fb`
- Reviewers: 2/2
- Samples: 204/204
- Human score rows: 816/816

## Thresholds

| Dimension | Observed | Rule | Status |
| --- | ---: | --- | --- |
| `outline_adherence` | 1 | min 0.9 | pass |
| `hook_prose_score` | 1.882353 | min 4 | fail |

## Release boundary

- Human structural evidence: complete
- Observed max inter-rater variance: 0
- Approved inter-rater variance threshold: not recorded
- Threshold decision owner: #240
- Quality release gate blockers: `decision-required:interRaterVarianceThreshold`, `threshold-failed:hook_prose_score`

## Warnings

- `reviewer-completion-times-identical`

The identical reviewer completion timestamp is retained as a warning because it is not forbidden by the frozen rubric. Reviewer attestations and independent-scoring declarations remain in the source files.
