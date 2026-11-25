# M3-07c-02 UI Capability and Total Traceability Closeout

> Issue: #238
> Parent: #104
> Status: implementation scope complete; current-head PR CI and merge are tracked in PR #268.
> Machine-readable UI evidence: `docs/implementation/m3-238-ui-capability-evidence.json`

## 1. Scope

This ticket closes the UI-001..UI-009 evidence ledger and reconciles it with the
17-page parity matrix, per-action API/persistence evidence, release checklist and
implementation frontier. It does not close #104, provide human quality review,
  certify 10M capacity or make a V1 release decision.

## 2. Blocker Verification

All declared blockers were closed and their merge commits are ancestors of the
`#238` base commit:

| Ticket | Delivered by | Merge commit |
| --- | --- | --- |
| #220 M3-07a | PR #243 | `fe584b478297ca8923ac17661f5d06e565dcd9c0` |
| #221 M3-07b-01 | PR #244 | `b5ca07b29bfdcc82a2096565419eb48098703b14` |
| #222 M3-07b-02 | PR #246 | `b05a5954d8e23086dc2d91e214da128774ff964d` |
| #223 M3-07b-03 | PR #248 | `2977bff3b47175179192533125694729df5c61ae` |
| #224 M3-07b-04 | PR #249 | `6c5ae0f2aa10d4f62204e489ed8adfc4712cb84d` |
| #225 M3-07b-05 | PR #250 | `0f2e9ac73f8be4f5761a407f73a607c11ce8ee81` |
| #226 M3-07b-06 | PR #251 | `b5b903612d014a3bbbac27ea40054fb3a73a629c` |
| #227 M3-07b-07 | PR #252 | `ab6791f42e8a576a66a6e4733717852a23bde889` |
| #228 M3-07b-08 | PR #253 | `5632f5fb9f4b207fc98a9ccbc6d8197ab9c6e695` |
| #229 M3-07b-09 | PR #254 | `e1e58645923e4ff82defbdc49f300284538a3b70` |
| #230 M3-07b-10 | PR #255 | `940fe8526eae0da7f3ad1657a75897f717103a0e` |
| #231 M3-07b-11 | PR #256 | `7f5217fb2c8b6bc5dd1998c92f371bf1eb12661a` |
| #232 M3-07b-12 | PR #257 | `1e2cce81cb862fca6f05c29088ed26378692c33f` |
| #233 M3-07b-13 | PR #258 | `d049b11211e0fdaf7a8eb3aae30554b58e01f794` |
| #234 M3-07b-14 | PR #259 | `e6cae5681751e032f6bb6d7f0df4b55777b1fe77` |
| #235 M3-07b-15 | PR #260 | `0ab8adc743724b6136a23cfe0269d97b522c74b4` |
| #236 M3-07c-01 | PR #264 | `066293ac5a9b8069d20062ed14d15afa4bc32383` |

The GitHub issue dependency summary reports zero open blockers for #238. The
related #263 evidence gap was delivered by PR #267 and is included in the base
commit `6bc4fa2a83172ae3ece9d75065462d973397333f`.

## 3. Result

- All 17 production pages are `parity-verified` in the parity matrix.
- All 15 non-static production pages have complete, verified action evidence.
- UI-001..UI-009 are `verified` in the traceability ledger.
- The release gate now reports UI capability and parity evidence as passing.
- V1 traceability records 113 of 116 V1 capabilities as `verified`; EVAL-002,
  EVAL-004 and CONT-001 retain bounded evidence gaps.
- The remaining release blockers are pending human adjudication/oracle content,
  the failed human prose-quality threshold, the approved inter-rater variance
  threshold, smoke model alias alignment (#271), quality remediation (#273) and the final #104 Production
  CI. #238 does not close #104.

## 4. Verification

The UI capability audit verifies:

- one machine-readable record for each UI-001..UI-009;
- exact status parity with the total traceability ledger;
- existing executable Playwright or guardrail evidence for every verified row;
- a completed successful Production CI run bound to the audited head;
- 17 production page specs with four viewport widths, screenshot comparison,
  author-language scanning and prototype-only leakage scanning;
- per-page required-state markers derived from the parity matrix;
- all three genre-pack creation paths, including the persisted urban template;
- the seven shared status families in `packages/contracts`;
- complete action evidence with no pending pages;
- documented design tokens/components that also exist in production CSS.

The release gate resolves completed successful pull-request runs for Production
CI, Deployment Smoke and Readiness on the current Git HEAD, rather than trusting
a fixed historical SHA or a push-only run. The final PR runs and head are
recorded in the PR evidence before merge.

Local verification:

- UI/release targeted Vitest passed.
- Guardrails: 16 files, 114/114 tests passed.
- Full Vitest: 126 files, 657/657 tests passed.
- Targeted `batch.spec.ts` loading/long-content Playwright test: 1/1 passed.
- Targeted `new-project.spec.ts` urban-template Playwright test: 1/1 passed.
- Targeted `work-overview.spec.ts` partial-data Playwright test: 1/1 passed.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm check:migrations` and
  `node scripts/validate-readiness.mjs` passed.
- `pnpm release:check` is rerun after the current-head Production CI completes;
  it must remove UI capability blockers and leave only blocked release status,
  final Production CI, the recorded quality failure and the three bounded
  non-UI capability gaps.

## 5. Boundary

This ticket does not claim that every V1 capability is already `verified` or
authorized-deferred. EVAL-002, EVAL-004 and CONT-001 remain explicit, bounded
release blockers. #239 records the human review, #240 owns the variance decision,
#271 owns the smoke model alias gap, and #104 remains open until those release
gates close.

This report does not record or substitute for:

- the recorded human blind-review scores in `docs/quality/evidence/m3-239/` (#239);
- the approved inter-rater variance threshold (#240);
- the final V1 release decision and final Production CI (#242/#104).
