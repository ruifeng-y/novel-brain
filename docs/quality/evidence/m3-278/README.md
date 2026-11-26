# M3-278 Clean Blind Packet Candidate Evidence

> Status: **awaiting-human-approval**
>
> Issue: #278

This directory contains the 24 oracle-free long-horizon replacement drafts, their deterministic
change manifest, and a candidate 204-sample clean blind packet. It does not contain a frozen
packet or a fabricated human approval.

## Files

- `replacement-candidates.source.json`: model-drafted candidate narratives and required beats,
  prepared for owner review and not represented as human-authored.
- `replacement-manifest.json`: original/replacement/required-beats hashes, source evidence and
  candidate dataset/packet hashes for all 24 replacements.
- `quality-benchmark-v2.dataset.candidate.json`: complete 204-sample candidate dataset. It is not
  the frozen v2 dataset.
- `reviewer-packet-v3.candidate.json`: candidate reviewer-facing packet with exactly four sample
  fields: `blindSampleId`, `genre`, `text`, `requiredBeats`.
- `approvals.template.json`: blank 24-item human approval record bound to the candidate hashes.
- `approval-request.md`: owner review entrance with sample ID, scenario family, severity, candidate
  narrative, required beats and per-item approval fields.
- `review-disposition.md`: disposition of the external review notes, including the 6 fixed hard
  findings and 11 recorded owner decisions; final 24/24 sample approval remains pending.
- `review-findings.source.json`: machine-readable external review disposition source. It pins the
  supplied review notes SHA-256 and the exact hard findings and owner decision prompts.
- `approval-request.review-notes.md`: exact copy of the user-supplied external review notes; its
  file SHA-256 matches `review-findings.source.json`.
- `status.json`: machine-readable pending state consumed by the implementation evidence.

## Current Gate

- Candidate dataset SHA-256: `3f754fe2ed302b43a742e66182562b7b64038c88ac65c7eebca5468af5a70dbf`
- Candidate packet SHA-256: `146236987d2d8452e00493416f0b2536809aea049b6e197f4ef2bf0ca0154d2b`
- Replacement manifest SHA-256: `2a222605d92c3f822eb364d9aff5b3f12fa63346214a78fc1e9efdfb8da8e991`
- Human approvals: `0/24`
- Freeze allowed: `false`
- Owner-visible established facts are bound in `replacement-manifest.json` and
  `approvals.template.json`, but never included in the reviewer packet.
- The 11 semantic decisions identified by the external review are recorded in
  `review-findings.source.json` and displayed in `approval-request.md`; final per-sample
  approval is still blank and remains a human gate.
- Old scores: `invalidated_for_clean_review`
- Variance threshold: #240 policy `0.1`, unchanged
- Downstream: #279 full rerun; #242 remains blocked by #278 and #279

The candidate packet must not be sent to blind reviewers until all 24 replacements are approved
and an external GitHub attestation containing `M3-278-HUMAN-APPROVAL` is recorded on #278.
The attestation is verified through the GitHub API for the `ruifeng-y` product/quality owner
with `OWNER` association, Issue 278, comment time, exact statement, candidate packet hash,
replacement manifest hash and the approval payload hash that covers all 24 item decisions.

## Reproduction

```powershell
pnpm quality:clean-packet
pnpm quality:clean-packet -- --check
pnpm exec vitest run scripts/test/m3-278-clean-blind-packet.test.mjs
```

## Human approval wizard

The interactive wizard never invents decisions. `Review` displays each candidate and records only
the owner's typed input. It deliberately rejects `-ResponseFile`, so formal review cannot be
silently generated from a prepared answer file, and it rejects redirected stdin so the formal gate
must run in an interactive console:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/m3-278-approval-wizard.ps1 -Mode Review
```

It writes `approvals.json`, computes the approval payload hash, and prints the exact GitHub comment
statement only after all 24 items are approved and all 11 recorded owner decisions accept the
current candidate. It does not publish the comment.

`Draft` is the non-interactive preparation path. It accepts a human-prepared response file, writes
`status=draft`, marks each entry as `adjudicatorKind=draft`, and never computes a freezable approval
payload or human attestation fields. A draft cannot be used by `Statement`, `Attestation`, or
`--freeze`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/m3-278-approval-wizard.ps1 -Mode Draft -ResponseFile .\responses.txt
```

After publishing the comment:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/m3-278-approval-wizard.ps1 -Mode Statement
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/m3-278-approval-wizard.ps1 -Mode Attestation
```

`Attestation` verifies the GitHub comment through `gh` before writing the attestation fields.

After all 24 samples and the GitHub attestation are approved:

```powershell
pnpm quality:clean-packet -- --payload-hash
pnpm quality:clean-packet
pnpm quality:clean-packet -- --freeze
```

`--freeze` refuses stale candidates or incomplete/unverified approvals. On success it writes the
frozen v2 dataset/manifest, final reviewer packet, freeze manifest and frozen status. The old v1
dataset, packet and 816 scores are never overwritten.
