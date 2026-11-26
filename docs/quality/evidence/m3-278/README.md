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
  findings and 11 owner decisions that remain pending.
- `review-findings.source.json`: machine-readable external review disposition source. It pins the
  supplied review notes SHA-256 and the exact hard findings and owner decision prompts.
- `approval-request.review-notes.md`: exact copy of the user-supplied external review notes; its
  file SHA-256 matches `review-findings.source.json`.
- `status.json`: machine-readable pending state consumed by the implementation evidence.

## Current Gate

- Candidate dataset SHA-256: `c8079604dfc8774d1aa0fbfa67c816f145cd4ae3705d75da30b5a27634ead4bd`
- Candidate packet SHA-256: `9569e6dd661ec2765b08fc3381f4b8406a37b0a4f66f4224c7cfa68b1aec8a6a`
- Replacement manifest SHA-256: `f8a8f0315c32fa5e751faa70fc2723916730cde9193456b838401a7ccb29e5a3`
- Human approvals: `0/24`
- Freeze allowed: `false`
- Owner-visible established facts are bound in `replacement-manifest.json` and
  `approvals.template.json`, but never included in the reviewer packet.
- The 11 semantic decisions identified by the external review are listed explicitly in
  `approval-request.md`; they remain owner decisions, not model approvals.
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
