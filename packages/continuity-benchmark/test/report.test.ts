import { describe, expect, it } from "vitest";

import { buildContinuityBlindReviewPacket } from "../src/blind-review";
import { evaluateContinuityFindings, type ContinuityFinding } from "../src/evaluator";
import { generateContinuityFixture } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";
import { buildContinuityBenchmarkReport } from "../src/report";

const plan = createContinuityPlan({ seed: 20261118, tier: "smoke" });
const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
const perfectFindings: ContinuityFinding[] = fixture.defects.map((defect) => ({
  family: defect.family,
  severity: defect.severity,
  chapterNumber: defect.chapterNumber,
  branchId: defect.branchId,
  entityIds: [...defect.entityIds],
  sourceFactId: defect.sourceFactId,
  versionNodeId: defect.versionNodeId,
  evidence: defect.evidence,
}));
const evaluation = evaluateContinuityFindings({ fixture, findings: perfectFindings });
const { packet, oracle } = buildContinuityBlindReviewPacket({
  fixture,
  samplesPerStratum: 2,
});

describe("continuity benchmark report", () => {
  it("blocks a perfect automatic run until human review and thresholds are approved", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: null,
      decisions: [],
    });

    expect(report.status).toBe("blocked");
    expect(report.continuityReady).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "blind-review-evidence-missing",
        "decision-required:blindReviewSamplesPerStratum",
        "decision-required:interRaterAgreementThreshold",
      ]),
    );
  });

  it("passes only with approved thresholds and stratified blind-review evidence", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: {
        samplesPerStratum: 2,
        reviewerIds: ["reviewer-a", "reviewer-b"],
        reviewedItemCount: packet.items.length,
        interRaterAgreement: 0.86,
        adjudicatedDisagreements: 2,
      },
      decisions: [
        {
          id: "blindReviewSamplesPerStratum",
          approved: true,
          owner: "product-owner",
          rationale: "approved review depth",
          approvedValue: 2,
          decidedAt: "2026-11-18T00:00:00.000Z",
        },
        {
          id: "interRaterAgreementThreshold",
          approved: true,
          owner: "product-owner",
          rationale: "approved agreement floor",
          approvedValue: 0.8,
          decidedAt: "2026-11-18T00:00:00.000Z",
        },
      ],
    });

    expect(report.status).toBe("passed");
    expect(report.continuityReady).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.evaluation.summary).toEqual(evaluation.summary);
  });

  it("keeps P0 misses and low reviewer agreement blocking", () => {
    const missed = evaluateContinuityFindings({
      fixture,
      findings: perfectFindings.filter((finding) => finding.family !== "knowledge_boundary"),
    });
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation: missed,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: {
        samplesPerStratum: 2,
        reviewerIds: ["reviewer-a", "reviewer-b"],
        reviewedItemCount: packet.items.length,
        interRaterAgreement: 0.5,
        adjudicatedDisagreements: 4,
      },
      decisions: [
        {
          id: "blindReviewSamplesPerStratum",
          approved: true,
          owner: "product-owner",
          rationale: "approved review depth",
          approvedValue: 2,
          decidedAt: "2026-11-18T00:00:00.000Z",
        },
        {
          id: "interRaterAgreementThreshold",
          approved: true,
          owner: "product-owner",
          rationale: "approved agreement floor",
          approvedValue: 0.8,
          decidedAt: "2026-11-18T00:00:00.000Z",
        },
      ],
    });

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "evaluation-gate-failed:knowledge-boundary-leak",
        "blind-review-agreement-below-threshold",
      ]),
    );
  });
});
