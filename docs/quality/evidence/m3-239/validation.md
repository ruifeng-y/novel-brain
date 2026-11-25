# M3-239 人工盲评证据校验

> Structural status: **COMPLETE-WITH-WARNINGS**
>
> Technical validation: **PASSED**
>
> Adjudication status: **PENDING**
>
> Quality gate: **BLOCKED**

## Frozen evidence

- Dataset SHA-256: `90c8c8c44540ae99246e243ac16c1158d7cee3485ac4b5c1a901b3b7164e753b`
- Rubric SHA-256: `247a1fcc0c0ce58bca7faa8a93a8b0d0e39c4095fc2f1c5748767b53d6fc1b3b`
- Evaluator gate hash: `91b3c844070a69a4eea51d6583d816d5d732d9ccad95f972a2d6a77b0287c2fb`
- Reviewer packet file SHA-256: `769abdfdb7f8486712d8fcd5b3784c14ffee5476572eb51e9839f4d1c19d432e`
- Reviewer packet canonical SHA-256: `3fdae556029834bfcb97c321c3486c1fe3d57df9d6630cc99484a0ea56ce847c`
- Reviewers: 2/2
- Samples: 204/204
- Human score rows: 816/816

## Adjudication

- Human review recorded: yes
- Human review completed: yes
- Completed adjudications: 0/24
- Pending samples: Q005, Q026, Q034, Q055, Q056, Q067, Q075, Q081, Q083, Q084, Q088, Q093, Q096, Q123, Q130, Q149, Q158, Q160, Q162, Q168, Q182, Q186, Q189, Q196

## Thresholds

| Dimension | Observed | Rule | Status |
| --- | ---: | --- | --- |
| `outline_adherence` | 1 | min 0.9 | pass |
| `hook_prose_score` | 1.882353 | min 4 | fail |

## Release boundary

- Observed max inter-rater variance: 0
- Approved inter-rater variance threshold: not recorded
- Threshold decision owner: #240
- Quality release gate blockers: `adjudication-pending:24`, `decision-required:interRaterVarianceThreshold`, `oracle-content-present:24`, `threshold-failed:hook_prose_score`
- Structural blockers: none

## Warnings

- `adjudication-pending:24`
- `oracle-content-present:24`
- `reviewer-completion-times-identical`
- `reviewer-identity-self-attested`

The identical reviewer completion timestamp is retained as a warning because it is not forbidden by the frozen rubric. Reviewer attestations and independent-scoring declarations remain in the source files.
