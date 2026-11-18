import { describe, expect, it } from "vitest";

import { buildContinuityBlindReviewPacket } from "../src/blind-review";
import { evaluateContinuityFindings } from "../src/evaluator";
import { generateContinuityFixture } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";
import { buildContinuityBenchmarkReport } from "../src/report";
import { findingsFor } from "./helpers";

const plan = createContinuityPlan({ seed: 20261118, tier: "minimum" });
const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
const perfectFindings = findingsFor(fixture);
const evaluation = evaluateContinuityFindings({ fixture, findings: perfectFindings });
const { packet, oracle } = buildContinuityBlindReviewPacket({
  fixture,
  samplesPerStratum: 2,
});

describe("continuity benchmark report", () => {
  it("blocks a non-certification fixture even when review evidence looks complete", () => {
    const nonCertificationFixture = structuredClone(fixture);
    nonCertificationFixture.plan.certificationEligible = false;
    const report = buildContinuityBenchmarkReport({
      fixture: nonCertificationFixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
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

    expect(report.status).toBe("blocked");
    expect(report.continuityReady).toBe(false);
    expect(report.blockers).toContain("fixture-not-certification-eligible");
  });

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

  it("blocks release when approved narrative-quality measurements are missing", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
      decisions: approvedDecisions(),
    });

    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("narrative-evidence-missing");
  });

  it("passes only with approved thresholds and stratified blind-review evidence", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.status).toBe("passed");
    expect(report.continuityReady).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.evaluation.summary).toEqual(evaluation.summary);
  });

  it("blocks every approved narrative metric that crosses its threshold", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.89,
        hookProseScore: 3.9,
        continuityConflictsPer50k: 1.1,
      },
    });

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "narrative-outline-adherence-below-threshold",
        "narrative-hook-prose-below-threshold",
        "narrative-continuity-conflicts-above-threshold",
      ]),
    );
  });

  it("blocks non-human reviewers", () => {
    const evidence = completeReviewEvidence(packet);
    evidence.reviewers[1]!.kind = "llm_self_score" as "human";
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: evidence,
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toEqual(
      expect.arrayContaining(["blind-review-reviewer-count-insufficient"]),
    );
  });

  it("blocks unresolved blind-review disagreements", () => {
    const evidence = completeReviewEvidence(packet, { disagreementCount: 1 });
    evidence.adjudications = [];
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: evidence,
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toContain("blind-review-adjudication-missing");
  });

  it("uses the adjudicated disposition for P0 calibration", () => {
    const evidence = completeReviewEvidence(packet, { disagreementCount: 1 });
    evidence.adjudications[0]!.decision = "no_defect";
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: evidence,
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toContain("blind-review-oracle-p0-miss");
  });

  it("blocks unanimous no-defect reviews when the oracle contains P0 defects", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet, { allNoDefect: true }),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("blind-review-oracle-p0-miss");
  });

  it("blocks a reviewer set that marks every clean-control sample as defective", () => {
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet, { allDefect: true }),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "blind-review-control-false-positive",
        "blind-review-incomplete-context-miss",
      ]),
    );
  });

  it("blocks fixture content that no longer matches its recorded digest", () => {
    const tamperedFixture = structuredClone(fixture);
    tamperedFixture.chapters[0]!.content += "tampered";
    const report = buildContinuityBenchmarkReport({
      fixture: tamperedFixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toContain("fixture-digest-mismatch");
  });

  it("blocks a fixture source commit that is not covered by its digest", () => {
    const tamperedFixture = structuredClone(fixture);
    tamperedFixture.digest.sourceCommit = "deadbee";
    const report = buildContinuityBenchmarkReport({
      fixture: tamperedFixture,
      evaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toContain("fixture-digest-mismatch");
  });

  it("blocks evaluation content that no longer matches its recorded digest", () => {
    const tamperedEvaluation = structuredClone(evaluation);
    tamperedEvaluation.summary.truePositives = 0;
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation: tamperedEvaluation,
      blindReviewPacket: packet,
      blindReviewOracle: oracle,
      reviewEvidence: completeReviewEvidence(packet),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toContain("evaluation-digest-mismatch");
  });

  it("blocks tampered blind-review packet or oracle artifacts", () => {
    const tamperedPacket = structuredClone(packet);
    tamperedPacket.items[0]!.candidateText += "tampered";
    const tamperedOracle = structuredClone(oracle);
    tamperedOracle.items[0]!.expectedDefectIds.push("tampered");
    const report = buildContinuityBenchmarkReport({
      fixture,
      evaluation,
      blindReviewPacket: tamperedPacket,
      blindReviewOracle: tamperedOracle,
      reviewEvidence: completeReviewEvidence(tamperedPacket),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "blind-review-packet-digest-mismatch",
        "blind-review-oracle-digest-mismatch",
      ]),
    );
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
      reviewEvidence: completeReviewEvidence(packet, { disagreementCount: 2 }),
      decisions: approvedDecisions(),
      narrativeEvidence: {
        outlineAdherence: 0.9,
        hookProseScore: 4,
        continuityConflictsPer50k: 1,
      },
    });

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "evaluation-gate-failed:knowledge-boundary-leak",
        "blind-review-agreement-below-threshold",
      ]),
    );
  });
});

function completeReviewEvidence(
  reviewPacket: typeof packet,
  options: { disagreementCount?: number; allNoDefect?: boolean; allDefect?: boolean } = {},
) {
  const disagreementCount = options.disagreementCount ?? 0;
  return {
    schemaVersion: 1 as const,
    packetSha256: reviewPacket.packetSha256,
    rubricVersion: reviewPacket.rubricVersion,
    samplesPerStratum: 2,
    reviewers: [
      {
        id: "reviewer-a",
        kind: "human" as const,
        displayName: "Reviewer A",
        attestedAt: "2026-11-18T00:00:00.000Z",
      },
      {
        id: "reviewer-b",
        kind: "human" as const,
        displayName: "Reviewer B",
        attestedAt: "2026-11-18T00:00:00.000Z",
      },
    ],
    items: reviewPacket.items.flatMap((item, itemIndex) =>
      ["reviewer-a", "reviewer-b"].map((reviewerId, reviewerIndex) => {
        const expected =
          oracle.items.find((oracleItem) => oracleItem.reviewId === item.reviewId)
            ?.expectedDisposition ?? "defect";
        return {
          reviewId: item.reviewId,
          reviewerId,
          disposition: options.allNoDefect
            ? "no_defect"
            : options.allDefect
              ? "defect"
              : itemIndex < disagreementCount && reviewerIndex === 1
                ? expected === "defect"
                  ? "no_defect"
                  : "defect"
                : expected,
          rubricScores: {
            factualContinuity: 5,
            knowledgeBoundary: 5,
            narrativeCausality: 5,
            outlineAdherence: 0.95,
            hookProse: 4.5,
          },
          confidence: 0.9,
          evidenceQuote: "样本中的证据句",
          reviewedAt: "2026-11-18T00:00:00.000Z",
        };
      }),
    ),
    adjudications: Array.from({ length: disagreementCount }, (_, index) => ({
      reviewId: reviewPacket.items[index]!.reviewId,
      adjudicatorId: "adjudicator-c",
      decision: "defect" as const,
      rationale: "按版本化 rubric 裁决",
      adjudicatedAt: "2026-11-18T00:00:00.000Z",
    })),
  };
}

function approvedDecisions() {
  return [
    {
      id: "blindReviewSamplesPerStratum" as const,
      approved: true,
      owner: "product-owner",
      rationale: "approved review depth",
      approvedValue: 2,
      decidedAt: "2026-11-18T00:00:00.000Z",
    },
    {
      id: "interRaterAgreementThreshold" as const,
      approved: true,
      owner: "product-owner",
      rationale: "approved agreement floor",
      approvedValue: 0.8,
      decidedAt: "2026-11-18T00:00:00.000Z",
    },
  ];
}
