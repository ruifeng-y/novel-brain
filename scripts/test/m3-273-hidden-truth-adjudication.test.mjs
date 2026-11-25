import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildM3_273Artifacts,
  computeM3_273DecisionPayloadSha256,
  evaluateM3_273Adjudication,
  scanOracleContent,
  sampleExposesOracleContent,
} from "../m3-273-adjudication.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("M3-273 hidden-truth adjudication", () => {
  it("proposes a clean packet without deleting or silently approving the 24 contaminated samples", async () => {
    const artifacts = await buildM3_273Artifacts({ root });

    expect(artifacts.proposalPacket.samples).toHaveLength(204);
    expect(artifacts.cleanupEvidence.transforms).toHaveLength(24);
    expect(
      artifacts.status.pendingSampleIds.every((sampleId) =>
        artifacts.cleanupEvidence.sourceContaminatedSampleIds.includes(sampleId),
      ),
    ).toBe(true);
    expect(artifacts.artifactFreshness).toEqual({
      status: "passed",
      stalePaths: [],
    });
    expect(
      artifacts.proposalPacket.samples.every(
        (sample) => !scanOracleContent(sample.text).contaminated,
      ),
    ).toBe(true);
    expect(
      artifacts.proposalPacket.samples.every(
        (sample) => !scanOracleContent(sample.requiredBeats.join(" ")).contaminated,
      ),
    ).toBe(true);
    expect(
      artifacts.proposalPacket.samples.every(
        (sample) =>
          Object.keys(sample).sort().join(",") ===
          ["blindSampleId", "genre", "requiredBeats", "text"].join(","),
      ),
    ).toBe(true);
    expect(artifacts.proposalPacket.status).toBe("proposed-not-approved");
    expect(artifacts.proposalPacket.reviewerReadiness).toEqual({
      status: "not-ready",
      cleanBlindReview: false,
      semanticOracleReviewRequired: true,
      caveat:
        "This proposal only removes the detected explicit oracle annotation. The adversarial event text and required beats still require a human packet decision; this is not a semantic clean-packet approval.",
    });
    expect(artifacts.status.reviewerReady).toBe(false);
    expect(typeof artifacts.status.cleanPacketApproved).toBe("boolean");
    expect(
      artifacts.status.completedAdjudicationCount + artifacts.status.pendingAdjudicationCount,
    ).toBe(24);
    if (artifacts.status.pendingAdjudicationCount > 0) {
      expect(artifacts.status.qualityGate.status).toBe("blocked");
    }
    expect(artifacts.status.separateDecisions).toEqual([
      {
        id: "interRaterVarianceThreshold",
        owner: "#240",
        status: "outside-this-issue",
        mayBeApprovedByThisIssue: false,
        releaseGateRequiresIndependentApproval: true,
      },
    ]);
  });

  it("treats contaminated required beats as oracle content even when body text is clean", () => {
    expect(
      sampleExposesOracleContent({
        text: "沈砚走进旧城。",
        requiredBeats: ["与已确认事实“身世：真实身世被宗门封存”冲突。"],
      }),
    ).toBe(true);
  });

  it("keeps every human decision field blank in the generated questionnaire", async () => {
    const artifacts = await buildM3_273Artifacts({ root });
    const template = artifacts.adjudicationTemplate;

    expect(template.status).toBe("awaiting-human-input");
    expect(template.humanAttestation).toMatchObject({
      provider: "github_issue_comment",
      issue: 273,
      requiredMarker: "M3-273-HUMAN-ATTESTATION",
      commentUrl: null,
      commentId: null,
      author: null,
      attestedAt: null,
      statement: null,
    });
    expect(template.packetDecision).toMatchObject({
      decision: null,
      oldScoresImpact: null,
      adjudicatorId: null,
      adjudicatorKind: null,
      attestationId: null,
      rationale: null,
      decidedAt: null,
    });
    expect(template.adjudications).toHaveLength(24);
    expect(
      template.adjudications.every(
        (entry) =>
          entry.decision === null &&
          entry.rationale === null &&
          entry.impact === null &&
          entry.adjudicatorId === null &&
          entry.adjudicatorKind === null &&
          entry.attestationId === null &&
          entry.decidedAt === null,
      ),
    ).toBe(true);
    expect(template.hookProseDisposition).toMatchObject({
      decision: null,
      owner: null,
      rationale: null,
      impact: null,
      followUpIssue: null,
      expiresAt: null,
      decidedAt: null,
    });
  });

  it("rejects pending, duplicated, non-human or incomplete adjudications", async () => {
    const artifacts = await buildM3_273Artifacts({ root });
    const pending = evaluateM3_273Adjudication({
      artifacts,
      adjudication: artifacts.adjudicationTemplate,
    });
    expect(pending.qualityGate.status).toBe("blocked");
    expect(pending.qualityGate.blockers).toContain("adjudication-pending:24");

    const duplicated = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(duplicated);
    duplicated.adjudications[1].blindSampleId = duplicated.adjudications[0].blindSampleId;
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: duplicated }).qualityGate.blockers,
    ).toContain("adjudication-duplicate:1");

    const nonHuman = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(nonHuman);
    nonHuman.adjudications[0].adjudicatorKind = "model";
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: nonHuman }).qualityGate.blockers,
    ).toContain("adjudication-non-human:1");

    const incomplete = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(incomplete);
    incomplete.adjudications[0].rationale = " ";
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: incomplete }).qualityGate.blockers,
    ).toContain("adjudication-incomplete:1");

    const wrongStatus = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(wrongStatus);
    wrongStatus.status = "awaiting-human-input";
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: wrongStatus }).qualityGate.blockers,
    ).toContain("adjudication-status-pending");

    const wrongHash = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(wrongHash);
    wrongHash.adjudications[0].proposedTextSha256 = "0".repeat(64);
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: wrongHash }).qualityGate.blockers,
    ).toContain("adjudication-sample-evidence-drift:1");

    const wrongBeatsHash = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(wrongBeatsHash);
    wrongBeatsHash.adjudications[0].requiredBeatsSha256 = "0".repeat(64);
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: wrongBeatsHash }).qualityGate.blockers,
    ).toContain("adjudication-sample-evidence-drift:1");

    const mixedPreserve = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(mixedPreserve, {
      packetDecision: "preserve_with_product_owner_approval",
    });
    mixedPreserve.adjudications[0].decision = "accept_clean_proposal";
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: mixedPreserve }).qualityGate.blockers,
    ).toContain("packet-decision-sample-disposition-mismatch");

    const missingOldScoreImpact = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(missingOldScoreImpact);
    missingOldScoreImpact.packetDecision.oldScoresImpact = null;
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: missingOldScoreImpact }).qualityGate
        .blockers,
    ).toContain("packet-decision-old-score-impact-missing");
  });

  it("accepts a complete human waiver without approving the separate variance threshold", async () => {
    const artifacts = await buildM3_273Artifacts({ root });
    const adjudication = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(adjudication, {
      packetDecision: "preserve_with_product_owner_approval",
      hookDecision: "approve_waiver",
    });

    const status = evaluateM3_273Adjudication({ artifacts, adjudication });

    expect(status.humanAdjudicationCompleted).toBe(true);
    expect(status.completedAdjudicationCount).toBe(24);
    expect(status.pendingAdjudicationCount).toBe(0);
    expect(status.qualityGate).toEqual({
      status: "pass",
      blockers: [],
    });
    expect(status.separateDecisions[0]).toMatchObject({
      id: "interRaterVarianceThreshold",
      owner: "#240",
      status: "outside-this-issue",
      mayBeApprovedByThisIssue: false,
      releaseGateRequiresIndependentApproval: true,
    });
  });

  it("keeps refreeze and replacement choices blocked until a new clean blind review exists", async () => {
    const artifacts = await buildM3_273Artifacts({ root });
    const refreeze = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(refreeze);
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: refreeze }).qualityGate.blockers,
    ).toContain("clean-blind-review-required");

    const replace = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(replace, { packetDecision: "replace_affected_samples" });
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: replace }).qualityGate.blockers,
    ).toContain("clean-blind-review-required");
  });

  it("rejects an expired or pre-decision hook/prose waiver", async () => {
    const artifacts = await buildM3_273Artifacts({ root });
    const adjudication = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(adjudication, {
      packetDecision: "preserve_with_product_owner_approval",
      hookDecision: "approve_waiver",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    expect(evaluateM3_273Adjudication({ artifacts, adjudication }).qualityGate.blockers).toContain(
      "hook-prose-waiver-expired",
    );
  });

  it("requires an external GitHub issue comment attestation before human completion", async () => {
    const artifacts = await buildM3_273Artifacts({ root });
    const adjudication = structuredClone(artifacts.adjudicationTemplate);
    completeHumanDecisions(adjudication, {
      packetDecision: "preserve_with_product_owner_approval",
      hookDecision: "approve_waiver",
    });
    adjudication.humanAttestation.commentUrl = null;
    adjudication.humanAttestation.commentId = null;
    adjudication.humanAttestation.author = null;
    adjudication.humanAttestation.attestedAt = null;
    adjudication.humanAttestation.statement = null;

    const status = evaluateM3_273Adjudication({ artifacts, adjudication });

    expect(status.humanAdjudicationCompleted).toBe(false);
    expect(status.qualityGate.blockers).toContain("human-attestation-pending");

    const replay = structuredClone(adjudication);
    completeHumanDecisions(replay, {
      packetDecision: "preserve_with_product_owner_approval",
    });
    replay.adjudications[0].rationale += " 篡改后的新理由。";
    expect(
      evaluateM3_273Adjudication({ artifacts, adjudication: replay }).qualityGate.blockers,
    ).toContain("human-attestation-incomplete");
  });

  it("rebuilds status from an explicitly supplied human decision file", async () => {
    const templateArtifacts = await buildM3_273Artifacts({ root });
    const adjudication = structuredClone(templateArtifacts.adjudicationTemplate);
    completeHumanDecisions(adjudication, {
      packetDecision: "preserve_with_product_owner_approval",
      hookDecision: "approve_waiver",
    });

    const artifacts = await buildM3_273Artifacts({
      root,
      adjudicationOverride: adjudication,
    });

    expect(artifacts.status).toMatchObject({
      decisionFileStatus: "provided",
      humanAdjudicationCompleted: true,
      completedAdjudicationCount: 24,
      pendingAdjudicationCount: 0,
      qualityGate: {
        status: "pass",
        blockers: [],
      },
    });
    expect(artifacts.decisionRequest).toContain("`adjudicatorKind`");
    expect(artifacts.decisionRequest).toContain("Required beats:");
  });
});

function completeHumanDecisions(
  adjudication,
  {
    packetDecision = "refreeze_clean_packet",
    hookDecision = "remediate_and_rerun",
    expiresAt = "2099-12-31T00:00:00.000Z",
  } = {},
) {
  const sampleDecision =
    packetDecision === "preserve_with_product_owner_approval"
      ? "preserve_source_with_product_owner_approval"
      : packetDecision === "replace_affected_samples"
        ? "replace_sample"
        : "accept_clean_proposal";
  adjudication.status = "complete";
  adjudication.packetDecision = {
    decision: packetDecision,
    oldScoresImpact: "invalidated_for_clean_review",
    adjudicatorId: "quality-owner",
    adjudicatorKind: "human",
    attestationId: "att-quality-owner-20261126",
    rationale: "冻结旧评分为警告证据，后续盲评使用未暴露 oracle 的候选包。",
    decidedAt: "2026-11-26T00:00:00.000Z",
  };
  adjudication.adjudications = adjudication.adjudications.map((entry) => ({
    ...entry,
    decision: sampleDecision,
    rationale: "保留样本身份并移除显式 oracle 注释。",
    impact: "旧文本只作为历史证据，候选包需重新人工盲评。",
    adjudicatorId: "quality-owner",
    adjudicatorKind: "human",
    attestationId: "att-quality-owner-20261126",
    decidedAt: "2026-11-26T00:00:00.000Z",
  }));
  adjudication.hookProseDisposition = {
    decision: hookDecision,
    owner: "quality-owner",
    rationale:
      hookDecision === "approve_waiver"
        ? "记录真实人工质量结论并承担发布风险。"
        : "低于冻结门槛，先修复再重新盲评。",
    impact:
      hookDecision === "approve_waiver"
        ? "仅用于当前冻结质量包，新样本仍按 rubric 复查。"
        : "候选包不得在重新评分前用于发布声明。",
    followUpIssue: hookDecision === "approve_waiver" ? "#242" : "#273",
    expiresAt: hookDecision === "approve_waiver" ? expiresAt : null,
    decidedAt: "2026-11-26T00:00:00.000Z",
  };
  const decisionPayloadSha256 = computeM3_273DecisionPayloadSha256(adjudication);
  adjudication.humanAttestation = {
    provider: "github_issue_comment",
    issue: 273,
    requiredMarker: "M3-273-HUMAN-ATTESTATION",
    proposalSha256: adjudication.proposalPacketSha256,
    decisionPayloadSha256,
    commentUrl: "https://github.com/ruifeng-y/novel-brain/issues/273#issuecomment-999999",
    commentId: "999999",
    author: "ruifeng-y",
    attestedAt: "2026-11-26T00:00:00.000Z",
    statement: `M3-273-HUMAN-ATTESTATION ${adjudication.proposalPacketSha256} ${decisionPayloadSha256}`,
  };
}
