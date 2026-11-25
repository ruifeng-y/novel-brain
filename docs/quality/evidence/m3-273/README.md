# M3-273 Hidden-Truth Adjudication Evidence

> Status: **blocked-awaiting-human-adjudication**
>
> Issue: #273

This directory prepares the bounded follow-up for the 24 long-horizon samples that expose
explicit defect annotations in the frozen #239 reviewer packet. It does not approve a new
packet, rewrite the frozen rubric or dataset, change any of the 816 recorded human scores, or
record a fabricated adjudication.

## Files

- `reviewer-packet-v2.proposal.json`: proposed 204-sample packet. The tool removes only the
  detected explicit oracle annotation from each affected text and required beat. It keeps all
  sample IDs and all sample count. Status is `proposed-not-approved`.
- `oracle-cleanup-evidence.json`: internal transform audit with the source and cleaned text
  hashes for all 24 affected samples. Do not send this file to blind reviewers.
- `adjudication.template.json`: blank decision structure for 24 sample decisions, the packet
  disposition, old-score impact and `hook_prose_score` disposition.
- `decision-request.md`: owner-facing decision request. This is not a reviewer packet.
- `status.json`: machine-readable gate state consumed by `pnpm release:check`.

The original packet, questionnaires and raw scores remain in
`docs/quality/evidence/m3-239/` as immutable historical evidence.

## Required Human Decisions

1. Record one real adjudication for every entry in `adjudication.template.json`.
2. Decide whether the clean proposal is re-frozen, affected samples are replaced, or the
   contaminated source is retained with explicit product-owner approval.
3. Record whether the old 816 scores are invalidated for a clean review or retained only as
   warning evidence.
4. Record whether `hook_prose_score = 1.882353 < 4` requires remediation and rerun, or a
   fully owned, dated waiver with impact and follow-up.
5. Keep the inter-rater variance threshold under #240. This evidence cannot approve it.

Every decision requires a human adjudicator identity, attestation ID, rationale, impact and
timestamp. Model-written or inferred decisions are invalid.

## Workflow

After the responsible human completes the decisions in
`docs/quality/evidence/m3-273/adjudication.json`:

```powershell
node scripts/m3-273-adjudication.mjs
node scripts/m3-273-adjudication.mjs --check
pnpm test:guardrails
pnpm release:check
```

`scripts/m3-273-adjudication.mjs` regenerates `status.json` from the human decision file and
never creates or edits `adjudication.json`. `--check` fails on stale generated evidence.

The proposed packet remains non-reviewable until the responsible human records the packet
decision. A text-pattern-clean result is not by itself a semantic quality approval.
