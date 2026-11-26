# M3-273 Hidden-Truth Adjudication Evidence

> Status: **decision-and-attestation-complete-follow-ups-pending**
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
- `adjudication.json`: 24/24 product-owner decisions recorded as `replace_sample`; external
  attestation recorded at
  [#issuecomment-7183183858](https://github.com/ruifeng-y/novel-brain/issues/273#issuecomment-7183183858).
- `attestation-comment.md`: exact owner-authored attestation comment, published as
  [#issuecomment-7183183858](https://github.com/ruifeng-y/novel-brain/issues/273#issuecomment-7183183858).
- `decision-request.md`: owner-facing decision request. This is not a reviewer packet.
- `status.json`: machine-readable gate state consumed by `pnpm release:check`.

The original packet, questionnaires and raw scores remain in
`docs/quality/evidence/m3-239/` as immutable historical evidence.

The variance threshold is not part of this ledger's approval. #240 already approved `0.1`
through `docs/quality/evidence/m3-240/review-policy.json`; this issue only detects drift from
that independent decision.

## Recorded Decision

1. `packetDecision = replace_affected_samples`.
2. `oldScoresImpact = invalidated_for_clean_review`.
3. All 24 adjudications are `replace_sample`.
4. `hookProseDisposition = remediate_and_rerun`, owner `ruifeng-y`, follow-up #279.
5. #278 owns replacement approval and clean-packet rebuild; #279 owns corpus remediation and
   the full 204-sample two-reviewer rerun.
6. The inter-rater variance threshold remains #240's independently approved `0.1`.

`refreeze_clean_packet` and `replace_affected_samples` do not become release-ready in this
issue: a new clean human blind review is still required. Only an explicit product-owner
preservation decision can retain the contaminated source without that rerun, and the hook/prose
failure still needs remediation or a complete unexpired waiver.

The proposal is intentionally marked `reviewerReadiness.status = not-ready`. Removing the
explicit fact-conflict suffix does not prove that the remaining adversarial event text is
semantically blind. Do not send the proposal to reviewers until a human packet decision and the
required new clean review are recorded.

The local adjudication record now points to the owner-authored GitHub comment
`#issuecomment-7183183858`. Release verification queries GitHub and rejects self-declared
`adjudicatorKind: "human"` without an external comment or after any decision payload changes.

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
`pnpm release:check` recomputes the ledger from the proposal, cleanup audit, template and human
decision file; it rejects a hand-edited `status.json` that differs from recomputed evidence.

The proposal remains non-reviewable until #278 supplies human-approved replacements and #279
completes the full rerun. A text-pattern-clean result is not by itself semantic quality approval.
