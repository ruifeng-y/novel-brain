import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertM3_278FreezeAllowed,
  buildM3_278Artifacts,
  scanM3_278ReviewerLeakage,
  verifyM3_278CandidateDatasetDigest,
  verifyM3_278ReplacementManifest,
} from "../m3-278-clean-packet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("M3-278 clean blind packet", () => {
  it("drafts exactly one replacement for every adjudicated sample and preserves 204 identities", async () => {
    const artifacts = await buildM3_278Artifacts({ root });
    const candidateIds = artifacts.replacementCandidates.candidates.map(
      (candidate) => candidate.blindSampleId,
    );
    const datasetIds = [
      ...artifacts.candidateDataset.chapterSamples,
      ...artifacts.candidateDataset.adversarialCases,
    ].map((sample) => sample.id);
    const packetIds = artifacts.candidatePacket.samples.map((sample) => sample.blindSampleId);

    expect(artifacts.replacementCandidates.candidates).toHaveLength(24);
    expect(new Set(candidateIds).size).toBe(24);
    expect(candidateIds).toEqual(
      expect.arrayContaining(
        artifacts.source.adjudication.adjudications.map((entry) => entry.blindSampleId),
      ),
    );
    expect(datasetIds).toHaveLength(204);
    expect(new Set(datasetIds).size).toBe(204);
    expect([...datasetIds].sort()).toEqual(
      [...artifacts.source.dataset.chapterSamples, ...artifacts.source.dataset.adversarialCases]
        .map((sample) => sample.id)
        .sort(),
    );
    expect(packetIds).toHaveLength(204);
    expect(new Set(packetIds).size).toBe(204);
    expect(packetIds).toEqual(artifacts.source.key.entries.map((entry) => entry.blindSampleId));
  });

  it("keeps reviewer-facing samples free of oracle, defect and approval metadata", async () => {
    const artifacts = await buildM3_278Artifacts({ root });
    const serialized = JSON.stringify(artifacts.candidatePacket.samples);

    expect(
      artifacts.candidatePacket.samples.every(
        (sample) =>
          Object.keys(sample).sort().join(",") ===
          ["blindSampleId", "genre", "requiredBeats", "text"].join(","),
      ),
    ).toBe(true);
    expect(
      artifacts.candidatePacket.samples.every(
        (sample) => scanM3_278ReviewerLeakage(sample).length === 0,
      ),
    ).toBe(true);
    for (const marker of [
      "与已确认事实",
      "explicit-confirmed-fact-conflict",
      "knowledge_boundary",
      "body_continuity",
      "expectedDisposition",
      "sourceFactId",
      "branchId",
      "versionNodeId",
      "P0",
      "P1",
      "P2",
      "另一条分支",
      "早期分支",
      "中期分支",
      "晚期分支",
      "另一条时间线",
      "未来的真相",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("blocks packet freeze until all 24 replacements and the human attestation are approved", async () => {
    const pending = await buildM3_278Artifacts({ root });

    expect(pending.approvalStatus).toMatchObject({
      status: "awaiting-human-approval",
      approvedCount: 0,
      pendingCount: 24,
      freezeAllowed: false,
    });
    expect(pending.status.blockers).toEqual(
      expect.arrayContaining([
        "replacement-approval-pending:24",
        "human-approval-attestation-pending",
      ]),
    );
    expect(() => assertM3_278FreezeAllowed(pending.approvalStatus)).toThrow(
      "M3_278_FREEZE_BLOCKED",
    );

    const modelApproval = structuredClone(pending.approvalTemplate);
    fillHumanApprovals(modelApproval, { adjudicatorKind: "model" });
    const modelResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: modelApproval,
      attestationVerifier: async () => true,
    });
    expect(modelResult.approvalStatus.freezeAllowed).toBe(false);
    expect(modelResult.approvalStatus.blockers).toContain("replacement-approval-non-human:24");

    const humanApproval = structuredClone(pending.approvalTemplate);
    fillHumanApprovals(humanApproval);
    const approved = await buildM3_278Artifacts({
      root,
      approvalsOverride: humanApproval,
      attestationVerifier: async () => true,
    });
    expect(approved.approvalStatus).toMatchObject({
      status: "complete",
      approvedCount: 24,
      pendingCount: 0,
      freezeAllowed: true,
    });
    expect(() => assertM3_278FreezeAllowed(approved.approvalStatus)).not.toThrow();

    const unverified = await buildM3_278Artifacts({
      root,
      approvalsOverride: humanApproval,
      attestationVerifier: async () => false,
    });
    expect(unverified.approvalStatus.freezeAllowed).toBe(false);
    expect(unverified.approvalStatus.blockers).toContain("human-approval-attestation-unverified");

    const mismatched = structuredClone(humanApproval);
    mismatched.candidatePacketSha256 = "0".repeat(64);
    const mismatchResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: mismatched,
      attestationVerifier: async () => true,
    });
    expect(mismatchResult.approvalStatus.freezeAllowed).toBe(false);
    expect(mismatchResult.approvalStatus.blockers).toContain("approval-candidate-packet-mismatch");
  });

  it("binds every replacement to source evidence and reproduces all artifact hashes", async () => {
    const first = await buildM3_278Artifacts({ root });
    const second = await buildM3_278Artifacts({ root });
    const manifest = first.replacementManifest;

    expect(first.artifactFreshness).toEqual({
      status: "passed",
      stalePaths: [],
    });
    expect(first.candidateDataset.manifest.datasetSha256).toBe(
      second.candidateDataset.manifest.datasetSha256,
    );
    expect(first.candidatePacket.packetSha256).toBe(second.candidatePacket.packetSha256);
    expect(manifest.manifestSha256).toBe(second.replacementManifest.manifestSha256);
    expect(verifyM3_278CandidateDatasetDigest(first.candidateDataset)).toBe(true);
    expect(verifyM3_278ReplacementManifest(manifest)).toBe(true);
    expect(manifest.replacements).toHaveLength(24);
    expect(new Set(manifest.replacements.map((entry) => entry.blindSampleId)).size).toBe(24);
    expect(first.approvalTemplate.replacementManifestSha256).toBe(manifest.manifestSha256);
    const manifestEntryBySampleId = new Map(
      manifest.replacements.map((entry) => [entry.blindSampleId, entry]),
    );
    for (const entry of manifest.replacements) {
      expect(entry.originalTextSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(entry.replacementTextSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(entry.requiredBeatsSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(entry.evidence.adjudicationPath).toBe(
        "docs/quality/evidence/m3-273/adjudication.json",
      );
      expect(entry.evidence.candidateSourcePath).toBe(
        "docs/quality/evidence/m3-278/replacement-candidates.source.json",
      );
    }
    expect(
      first.approvalTemplate.approvals.every(
        (entry) =>
          entry.manifestEntrySha256 ===
          hashCanonical(manifestEntryBySampleId.get(entry.blindSampleId)),
      ),
    ).toBe(true);
    expect(manifest.source.rubricSha256).toBe(first.source.rubric.sha256);
    expect(manifest.source.reviewPolicy.interRaterVarianceThreshold).toBe(0.1);
    expect(manifest.source.oldScores).toMatchObject({
      status: "invalidated_for_clean_review",
      includedInCleanReview: false,
      sha256: "8d512dbf052429fa51debc053cbc046772ab50638afa7e9c0eb5a2c8240e20bc",
    });
    expect(first.status.blockingIssues).toEqual(["#279", "#242"]);
    expect(first.approvalRequest.match(/^### Q\d{3}$/gmu)).toHaveLength(24);
    expect(first.approvalRequest).toContain("- 场景 family:");
    expect(first.approvalRequest).toContain("候选叙事：");
    expect(first.approvalRequest).toContain("必须保留的 beats：");
    expect(first.approvalRequest).toContain("`adjudicatorKind`: 必须为 `human`");
  });
});

function hashCanonical(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function fillHumanApprovals(approval, { adjudicatorKind = "human" } = {}) {
  approval.status = "complete";
  approval.approvals = approval.approvals.map((entry) => ({
    ...entry,
    decision: "approve",
    rationale: "候选叙事未暴露 oracle 元信息，并保留了该样本的场景与严重度。",
    impact: "可进入 clean packet 候选，但仍须等待完整人工重评。",
    adjudicatorId: "quality-owner",
    adjudicatorKind,
    attestationId: "att-quality-owner-m3-278",
    decidedAt: "2026-11-26T00:00:00.000Z",
  }));
  approval.humanAttestation = {
    ...approval.humanAttestation,
    commentUrl: "https://github.com/ruifeng-y/novel-brain/issues/278#issuecomment-999999",
    commentId: "999999",
    author: "ruifeng-y",
    attestedAt: "2026-11-26T00:00:00.000Z",
    statement: `M3-278-HUMAN-APPROVAL ${approval.candidatePacketSha256} ${approval.replacementManifestSha256}`,
  };
}
