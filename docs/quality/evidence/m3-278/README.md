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
- `status.json`: machine-readable pending state consumed by the implementation evidence.

## Current Gate

- Candidate dataset SHA-256: `b5404a7469887a18dee21a1937d3cec24777d5c79520e5c9e25a51e18c0e5e5d`
- Candidate packet SHA-256: `3c33120dd10e95ee89ccd9351e192062b5b7b442aa1b8d11c1d70e394a693ebe`
- Replacement manifest SHA-256: `880487461a063c7125c8d711fe9191c96bc32e6b324fe26f126f59c56ab70ba6`
- Human approvals: `0/24`
- Freeze allowed: `false`
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
