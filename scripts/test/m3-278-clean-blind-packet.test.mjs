import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertM3_278ReviewerPacketClean,
  assertM3_278ReplacementCoverage,
  assertM3_278FreezeAllowed,
  buildM3_278Artifacts,
  computeM3_278ApprovalPayloadSha256,
  scanM3_278ReviewerLeakage,
  verifyM3_278GithubApprovalAttestation,
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
    const duplicateDatasetMapping = structuredClone(artifacts.replacementCandidates.candidates);
    duplicateDatasetMapping[1].datasetSampleId = duplicateDatasetMapping[0].datasetSampleId;
    expect(() =>
      assertM3_278ReplacementCoverage(duplicateDatasetMapping, {
        expectedBlindSampleIds: artifacts.replacementCandidates.candidates.map(
          (candidate) => candidate.blindSampleId,
        ),
        expectedDatasetSampleIds: artifacts.replacementCandidates.candidates.map(
          (candidate) => candidate.datasetSampleId,
        ),
      }),
    ).toThrow("M3_278_REPLACEMENT_COVERAGE_INVALID");
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
    const leakedPacket = createReviewerPacketForTest({
      samples: Array.from({ length: 204 }, (_, index) => ({
        blindSampleId: `Q${String(index + 1).padStart(3, "0")}`,
        genre: "仙侠",
        text: "干净叙事。",
        requiredBeats: ["干净叙事。"],
      })),
    });
    leakedPacket.samples[0].text = "这段文本带有与已确认事实“测试”冲突。";
    rehashReviewerPacket(leakedPacket);
    expect(() => assertM3_278ReviewerPacketClean(leakedPacket)).toThrow(
      "M3_278_REVIEWER_PACKET_LEAKAGE",
    );
    expect(() => assertM3_278ReviewerPacketClean(undefined)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    expect(() => assertM3_278ReviewerPacketClean({ samples: [] })).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    expect(() => assertM3_278ReviewerPacketClean({ samples: Array(204).fill(null) })).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const missingBeats = structuredClone(leakedPacket);
    missingBeats.samples[0].text = "干净叙事。";
    delete missingBeats.samples[0].requiredBeats;
    expect(() => assertM3_278ReviewerPacketClean(missingBeats)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const leakedGenre = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    leakedGenre.samples[0].text = "干净叙事。";
    leakedGenre.samples[0].genre = "P0";
    expect(() => assertM3_278ReviewerPacketClean(leakedGenre)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const hiddenTopLevel = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    hiddenTopLevel.samples[0].text = "干净叙事。";
    hiddenTopLevel.hiddenFacts = ["oracle"];
    expect(() => assertM3_278ReviewerPacketClean(hiddenTopLevel)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const nestedHiddenField = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    nestedHiddenField.samples[0].text = "干净叙事。";
    nestedHiddenField.source.oracle = "hidden-fact";
    expect(() => assertM3_278ReviewerPacketClean(nestedHiddenField)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const nestedLeakValue = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    nestedLeakValue.samples[0].text = "干净叙事。";
    nestedLeakValue.reviewerReadiness.expectedDisposition = "approve";
    expect(() => assertM3_278ReviewerPacketClean(nestedLeakValue)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const nestedLeakString = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    nestedLeakString.samples[0].text = "干净叙事。";
    nestedLeakString.source.sourcePacketVersion = "oracle-v1";
    rehashReviewerPacket(nestedLeakString);
    expect(() => assertM3_278ReviewerPacketClean(nestedLeakString)).toThrow(
      "M3_278_REVIEWER_PACKET_LEAKAGE",
    );
    const leakedStatus = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    leakedStatus.samples[0].text = "干净叙事。";
    leakedStatus.status = "oracle";
    expect(() => assertM3_278ReviewerPacketClean(leakedStatus)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const leakedPacketHash = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    leakedPacketHash.samples[0].text = "干净叙事。";
    leakedPacketHash.packetSha256 = "body_continuity";
    expect(() => assertM3_278ReviewerPacketClean(leakedPacketHash)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
    const changedAfterHash = createReviewerPacketForTest({
      samples: structuredClone(leakedPacket.samples),
    });
    changedAfterHash.samples[0].text = "哈希后改写。";
    expect(() => assertM3_278ReviewerPacketClean(changedAfterHash)).toThrow(
      "M3_278_REVIEWER_PACKET_INVALID",
    );
  });

  it("exposes established facts to the owner and fixes the six hard candidate findings", async () => {
    const artifacts = await buildM3_278Artifacts({ root });
    const candidateById = new Map(
      artifacts.replacementCandidates.candidates.map((candidate) => [
        candidate.blindSampleId,
        candidate,
      ]),
    );
    const reviewerSerialized = JSON.stringify(artifacts.candidatePacket.samples);

    expect(
      artifacts.replacementCandidates.candidates.every(
        (candidate) => candidate.establishedFact.trim().length > 0,
      ),
    ).toBe(true);
    expect(reviewerSerialized).not.toContain("establishedFact");
    expect(artifacts.approvalRequest).toContain("- 既定事实:");
    expect(artifacts.approvalRequest.match(/^- Q\d{3}:/gmu)).toHaveLength(11);
    expect(artifacts.status).toMatchObject({
      ownerDecisionPendingCount: 11,
      hardReviewFindingsResolved: 6,
    });
    expect(artifacts.approvalTemplate.reviewFindingsSha256).toBe(
      artifacts.source.fileSha256.reviewFindings,
    );
    expect(artifacts.source.reviewFindings.hardFindings).toHaveLength(6);
    expect(artifacts.source.reviewFindings.ownerDecisions).toHaveLength(11);

    expect(candidateById.get("Q034").requiredBeats).toContain(
      "北境关的茶棚里，披斗篷的人却已经念出信中那桩秘事，连末尾的暗记都没有错。",
    );
    expect(candidateById.get("Q055").text).toContain("沈砚从未打开过那只匣，也没人告诉过他");
    expect(candidateById.get("Q067").text).toMatch(/夹板|骨折/u);
    expect(candidateById.get("Q067").text).not.toMatch(/断腕|空袖/u);
    expect(candidateById.get("Q081").text).toContain("照骨镜");
    expect(candidateById.get("Q084").text).toContain("北境关");
    expect(candidateById.get("Q123").text).not.toContain("墨迹");
  });

  it("validates GitHub approval attestations by owner, issue, time and exact payload", () => {
    const attestation = {
      provider: "github_issue_comment",
      issue: 278,
      requiredMarker: "M3-278-HUMAN-APPROVAL",
      approvalPayloadSha256: "a".repeat(64),
      commentId: "7183183858",
      commentUrl: "https://github.com/ruifeng-y/novel-brain/issues/278#issuecomment-7183183858",
      author: "ruifeng-y",
      attestedAt: "2026-11-26T06:00:00Z",
      statement: `M3-278-HUMAN-APPROVAL ${"a".repeat(64)}`,
    };
    const comment = {
      body: attestation.statement,
      issueUrl: "https://api.github.com/repos/ruifeng-y/novel-brain/issues/278",
      author: "ruifeng-y",
      authorAssociation: "OWNER",
      createdAt: "2026-11-26T06:00:20Z",
    };

    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => comment,
      }),
    ).toBe(true);
    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => ({ ...comment, authorAssociation: "COLLABORATOR" }),
      }),
    ).toBe(false);
    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => ({ ...comment, author: "another-owner" }),
      }),
    ).toBe(false);
    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => ({
          ...comment,
          issueUrl: "https://api.github.com/repos/ruifeng-y/novel-brain/issues/273",
        }),
      }),
    ).toBe(false);
    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => ({ ...comment, createdAt: "2026-11-26T06:02:00Z" }),
      }),
    ).toBe(false);
    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => ({ ...comment, createdAt: "1" }),
      }),
    ).toBe(false);
    expect(
      verifyM3_278GithubApprovalAttestation(
        { ...attestation, attestedAt: "1" },
        {
          githubApi: () => comment,
        },
      ),
    ).toBe(false);
    expect(
      verifyM3_278GithubApprovalAttestation(attestation, {
        githubApi: () => ({ ...comment, body: `${comment.body}\n额外篡改` }),
      }),
    ).toBe(false);
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
    const pendingPayload = computeM3_278ApprovalPayloadSha256(pending.approvalTemplate);
    const completeStatus = structuredClone(pending.approvalTemplate);
    completeStatus.status = "complete";
    const completePayload = computeM3_278ApprovalPayloadSha256(completeStatus);
    expect(completePayload).not.toBe(pendingPayload);
    const attestationOnly = structuredClone(completeStatus);
    attestationOnly.humanAttestation.commentUrl =
      "https://github.com/ruifeng-y/novel-brain/issues/278#issuecomment-999999";
    expect(computeM3_278ApprovalPayloadSha256(attestationOnly)).toBe(completePayload);

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

    const datasetMismatch = structuredClone(humanApproval);
    datasetMismatch.candidateDatasetSha256 = "0".repeat(64);
    const datasetMismatchResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: datasetMismatch,
      attestationVerifier: async () => true,
    });
    expect(datasetMismatchResult.approvalStatus.blockers).toContain(
      "approval-candidate-dataset-mismatch",
    );

    const manifestMismatch = structuredClone(humanApproval);
    manifestMismatch.replacementManifestSha256 = "0".repeat(64);
    const manifestMismatchResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: manifestMismatch,
      attestationVerifier: async () => true,
    });
    expect(manifestMismatchResult.approvalStatus.blockers).toContain(
      "approval-replacement-manifest-mismatch",
    );

    const identityMismatch = structuredClone(humanApproval);
    identityMismatch.approvals[0].attestationId = "github-issue-comment-123";
    const identityResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: identityMismatch,
      attestationVerifier: async () => true,
    });
    expect(identityResult.approvalStatus.freezeAllowed).toBe(false);
    expect(identityResult.approvalStatus.blockers).toContain(
      "replacement-approval-identity-mismatch:1",
    );

    const looseTimestamp = structuredClone(humanApproval);
    looseTimestamp.approvals[0].decidedAt = "1";
    const timestampResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: looseTimestamp,
      attestationVerifier: async () => true,
    });
    expect(timestampResult.approvalStatus.freezeAllowed).toBe(false);
    expect(timestampResult.approvalStatus.blockers).toContain("replacement-approval-incomplete:1");

    const invalidCalendar = structuredClone(humanApproval);
    invalidCalendar.approvals[0].decidedAt = "2026-02-30T00:00:00.000Z";
    const calendarResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: invalidCalendar,
      attestationVerifier: async () => true,
    });
    expect(calendarResult.approvalStatus.blockers).toContain("replacement-approval-incomplete:1");

    const staleDecision = structuredClone(humanApproval);
    staleDecision.approvals[0].decidedAt = "2026-01-01T00:00:00.000Z";
    const staleResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: staleDecision,
      attestationVerifier: async () => true,
    });
    expect(staleResult.approvalStatus.blockers).toContain("replacement-approval-incomplete:1");

    const payloadDrift = structuredClone(humanApproval);
    payloadDrift.approvals[0].rationale += " 外部声明后补写。";
    const payloadResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: payloadDrift,
      attestationVerifier: async () => true,
    });
    expect(payloadResult.approvalStatus.freezeAllowed).toBe(false);
    expect(payloadResult.approvalStatus.blockers).toContain("human-approval-attestation-pending");

    const reviseDecision = structuredClone(humanApproval);
    reviseDecision.approvals.find((entry) => entry.blindSampleId === "Q026").reviewDecision =
      "revise_candidate";
    const reviseResult = await buildM3_278Artifacts({
      root,
      approvalsOverride: reviseDecision,
      attestationVerifier: async () => true,
    });
    expect(reviseResult.approvalStatus.freezeAllowed).toBe(false);
    expect(reviseResult.approvalStatus.blockers).toContain("owner-review-decision-blocks-freeze:1");
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
    const { datasetSha256, ...manifestWithoutDigest } = first.candidateDataset.manifest;
    expect(datasetSha256).toBe(
      hashCanonical({
        schemaVersion: first.candidateDataset.schemaVersion,
        chapterSamples: first.candidateDataset.chapterSamples,
        adversarialCases: first.candidateDataset.adversarialCases,
        manifest: manifestWithoutDigest,
      }),
    );
    const reorderedDataset = structuredClone(first.candidateDataset);
    reorderedDataset.manifest = Object.fromEntries(
      Object.entries(reorderedDataset.manifest).reverse(),
    );
    expect(verifyM3_278CandidateDatasetDigest(reorderedDataset)).toBe(true);
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
    const branchCandidates = first.replacementCandidates.candidates.filter(
      (candidate) => candidate.family === "branch_divergence",
    );
    expect(branchCandidates).toHaveLength(3);
    expect(
      branchCandidates.every(
        (candidate) =>
          candidate.text.includes("同源") ||
          candidate.text.includes("两册") ||
          candidate.text.includes("旧稿"),
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

function createReviewerPacketForTest({ samples }) {
  const packet = {
    schemaVersion: 1,
    packetVersion: "quality-benchmark-clean-blind-v3",
    status: "candidate-not-approved",
    issue: 278,
    source: {
      sourcePacketVersion: "m3-239-quality-blind-review-v1",
      sourcePacketFileSha256: "b".repeat(64),
      sourcePacketCanonicalSha256: "c".repeat(64),
      sourceDatasetVersion: "quality-benchmark-v1",
      sourceDatasetSha256: "d".repeat(64),
      candidateDatasetVersion: "quality-benchmark-v2",
      candidateDatasetSha256: "e".repeat(64),
      rubricVersion: "adr-0022-v1",
      rubricSha256: "f".repeat(64),
    },
    reviewerReadiness: {
      status: "not-ready",
      cleanBlindReview: false,
      humanReplacementApprovalRequired: 24,
    },
    samples,
    packetSha256: null,
  };
  return rehashReviewerPacket(packet);
}

function rehashReviewerPacket(packet) {
  packet.packetSha256 = hashCanonical({
    schemaVersion: packet.schemaVersion,
    packetVersion: packet.packetVersion,
    status: packet.status,
    issue: packet.issue,
    source: packet.source,
    reviewerReadiness: packet.reviewerReadiness,
    samples: packet.samples,
  });
  return packet;
}

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
    adjudicatorId: "ruifeng-y",
    adjudicatorKind,
    attestationId: `M3-278-APPROVAL-${entry.blindSampleId}`,
    decidedAt: "2026-11-26T00:00:00.000Z",
    reviewDecision: entry.reviewDecisionPrompt ? "accept_current" : "not-required",
    reviewDecisionRationale: entry.reviewDecisionPrompt ? "接受当前候选并保留该语义。" : null,
  }));
  approval.humanAttestation = {
    ...approval.humanAttestation,
    commentUrl: "https://github.com/ruifeng-y/novel-brain/issues/278#issuecomment-999999",
    commentId: "999999",
    author: "ruifeng-y",
    attestedAt: "2026-11-26T00:00:00.000Z",
    approvalPayloadSha256: null,
    statement: null,
  };
  const approvalPayloadSha256 = computeM3_278ApprovalPayloadSha256(approval);
  approval.humanAttestation.approvalPayloadSha256 = approvalPayloadSha256;
  approval.humanAttestation.statement = `M3-278-HUMAN-APPROVAL ${approval.candidatePacketSha256} ${approval.replacementManifestSha256} ${approvalPayloadSha256}`;
}
