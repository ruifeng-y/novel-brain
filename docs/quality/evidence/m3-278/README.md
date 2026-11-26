# M3-278 Clean Blind Packet Candidate Evidence

> Status: **awaiting-human-approval**
>
> Issue: #278

This directory contains the 24 oracle-free long-horizon replacement drafts, their deterministic
change manifest, and a candidate 204-sample clean blind packet. It does not contain a frozen
packet or a fabricated human approval.

## Files

- `replacement-candidates.source.json`: owner-authored candidate narratives and required beats.
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

- Candidate dataset SHA-256: `e38afca7dd06e13a79cc9c3540b9a10eb0c34f61ec28bd29b46bb127038da306`
- Candidate packet SHA-256: `9552e33f6379b02828c390550fca97784426a05222adaafe5405ddb056dc38f3`
- Replacement manifest SHA-256: `8187aed7a9974b5726afb97ba21c1a91fbd35bc8ae25098ee8df100fc4218f1d`
- Human approvals: `0/24`
- Freeze allowed: `false`
- Old scores: `invalidated_for_clean_review`
- Variance threshold: #240 policy `0.1`, unchanged
- Downstream: #279 full rerun; #242 remains blocked by #278 and #279

The candidate packet must not be sent to blind reviewers until all 24 replacements are approved
and an external GitHub attestation containing `M3-278-HUMAN-APPROVAL` is recorded on #278.
The attestation is verified through the GitHub API for owner/member/collaborator association,
Issue 278, comment time, exact statement, candidate packet hash and replacement manifest hash.

## Reproduction

```powershell
pnpm quality:clean-packet
pnpm quality:clean-packet -- --check
pnpm exec vitest run scripts/test/m3-278-clean-blind-packet.test.mjs
```
