import type { BlindReviewOracle, BlindReviewPacket } from "./blind-review";
import type { ContinuityEvaluation } from "./evaluator";
import type { ContinuityFixture } from "./fixture";

export interface ContinuityReviewEvidence {
  samplesPerStratum: number;
  reviewerIds: readonly string[];
  reviewedItemCount: number;
  interRaterAgreement: number;
  adjudicatedDisagreements: number;
}

export interface ContinuityBenchmarkDecision {
  id: "blindReviewSamplesPerStratum" | "interRaterAgreementThreshold";
  approved: boolean;
  owner: string;
  rationale: string;
  approvedValue: number;
  decidedAt: string;
}

export interface ContinuityBenchmarkReport {
  formatVersion: 1;
  status: "passed" | "blocked";
  continuityReady: boolean;
  blockerCount: number;
  blockers: readonly string[];
  fixture: {
    seed: number;
    tier: ContinuityFixture["plan"]["tier"];
    sourceCommit: string;
    chapterCount: number;
    volumeCount: number;
    branchCount: number;
    defectCount: number;
    controlCount: number;
    sha256: string;
  };
  evaluation: ContinuityEvaluation;
  blindReview: {
    packetSha256: string;
    oracleSha256: string;
    samplesPerStratum: number | null;
    reviewedItemCount: number;
    reviewerCount: number;
    interRaterAgreement: number | null;
    adjudicatedDisagreements: number;
  };
  decisions: readonly ContinuityBenchmarkDecision[];
}

export function buildContinuityBenchmarkReport(input: {
  fixture: ContinuityFixture;
  evaluation: ContinuityEvaluation;
  blindReviewPacket: BlindReviewPacket;
  blindReviewOracle: BlindReviewOracle;
  reviewEvidence: ContinuityReviewEvidence | null;
  decisions: readonly ContinuityBenchmarkDecision[];
}): ContinuityBenchmarkReport {
  const blockers = new Set<string>();

  for (const blocker of input.evaluation.releaseGate.blockers) {
    blockers.add(`evaluation-gate-failed:${blocker}`);
  }
  if (input.blindReviewPacket.fixtureSha256 !== input.fixture.digest.sha256) {
    blockers.add("blind-review-packet-fixture-mismatch");
  }
  if (input.blindReviewOracle.fixtureSha256 !== input.fixture.digest.sha256) {
    blockers.add("blind-review-oracle-fixture-mismatch");
  }
  for (const stratum of ["early", "middle", "late"] as const) {
    if (!input.blindReviewPacket.items.some((item) => item.stratum === stratum)) {
      blockers.add(`blind-review-stratum-missing:${stratum}`);
    }
  }
  if (input.blindReviewPacket.items.length !== input.blindReviewOracle.items.length) {
    blockers.add("blind-review-oracle-count-mismatch");
  }

  const approved = new Map(
    input.decisions
      .filter(isApprovedDecision)
      .map((decision) => [decision.id, decision.approvedValue]),
  );
  for (const id of ["blindReviewSamplesPerStratum", "interRaterAgreementThreshold"] as const) {
    if (!approved.has(id)) {
      blockers.add(`decision-required:${id}`);
    }
  }

  if (!input.reviewEvidence) {
    blockers.add("blind-review-evidence-missing");
  } else {
    const expectedSamples = approved.get("blindReviewSamplesPerStratum");
    const agreementThreshold = approved.get("interRaterAgreementThreshold");
    if (
      expectedSamples !== undefined &&
      input.reviewEvidence.samplesPerStratum !== expectedSamples
    ) {
      blockers.add("blind-review-sample-count-mismatch");
    }
    if (input.reviewEvidence.reviewedItemCount !== input.blindReviewPacket.items.length) {
      blockers.add("blind-review-items-incomplete");
    }
    if (new Set(input.reviewEvidence.reviewerIds).size < 2) {
      blockers.add("blind-review-reviewer-count-insufficient");
    }
    if (
      agreementThreshold !== undefined &&
      input.reviewEvidence.interRaterAgreement < agreementThreshold
    ) {
      blockers.add("blind-review-agreement-below-threshold");
    }
  }

  const blockerList = [...blockers].sort();
  const status = blockerList.length === 0 ? "passed" : "blocked";
  return {
    formatVersion: 1,
    status,
    continuityReady: status === "passed",
    blockerCount: blockerList.length,
    blockers: blockerList,
    fixture: {
      seed: input.fixture.plan.seed,
      tier: input.fixture.plan.tier,
      sourceCommit: input.fixture.digest.sourceCommit,
      chapterCount: input.fixture.digest.chapterCount,
      volumeCount: input.fixture.digest.volumeCount,
      branchCount: input.fixture.branches.length,
      defectCount: input.fixture.digest.defectCount,
      controlCount: input.fixture.digest.controlCount,
      sha256: input.fixture.digest.sha256,
    },
    evaluation: input.evaluation,
    blindReview: {
      packetSha256: input.blindReviewPacket.packetSha256,
      oracleSha256: input.blindReviewOracle.oracleSha256,
      samplesPerStratum: input.reviewEvidence?.samplesPerStratum ?? null,
      reviewedItemCount: input.reviewEvidence?.reviewedItemCount ?? 0,
      reviewerCount: new Set(input.reviewEvidence?.reviewerIds ?? []).size,
      interRaterAgreement: input.reviewEvidence?.interRaterAgreement ?? null,
      adjudicatedDisagreements: input.reviewEvidence?.adjudicatedDisagreements ?? 0,
    },
    decisions: input.decisions,
  };
}

function isApprovedDecision(decision: ContinuityBenchmarkDecision): boolean {
  if (
    !decision.approved ||
    !decision.owner.trim() ||
    !decision.rationale.trim() ||
    !decision.decidedAt
  ) {
    return false;
  }
  if (decision.id === "blindReviewSamplesPerStratum") {
    return Number.isInteger(decision.approvedValue) && decision.approvedValue > 0;
  }
  return (
    Number.isFinite(decision.approvedValue) &&
    decision.approvedValue >= 0 &&
    decision.approvedValue <= 1
  );
}
