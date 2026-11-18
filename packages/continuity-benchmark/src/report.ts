import type { BlindReviewOracle, BlindReviewPacket } from "./blind-review";
import type { ContinuityEvaluation } from "./evaluator";
import type { ContinuityFixture } from "./fixture";

export type ContinuityReviewDisposition = "defect" | "no_defect" | "escalate";

export interface ContinuityReviewer {
  id: string;
  kind: "human";
  displayName: string;
  attestedAt: string;
}

export interface ContinuityReviewRubricScores {
  factualContinuity: number;
  knowledgeBoundary: number;
  narrativeCausality: number;
  outlineAdherence: number;
  hookProse: number;
}

export interface ContinuityReviewItemScore {
  reviewId: string;
  reviewerId: string;
  disposition: ContinuityReviewDisposition;
  rubricScores: ContinuityReviewRubricScores;
  confidence: number;
  evidenceQuote: string;
  reviewedAt: string;
}

export interface ContinuityReviewAdjudication {
  reviewId: string;
  adjudicatorId: string;
  decision: ContinuityReviewDisposition;
  rationale: string;
  adjudicatedAt: string;
}

export interface ContinuityReviewEvidence {
  schemaVersion: 1;
  packetSha256: string;
  rubricVersion: string;
  samplesPerStratum: number;
  reviewers: readonly ContinuityReviewer[];
  items: readonly ContinuityReviewItemScore[];
  adjudications: readonly ContinuityReviewAdjudication[];
}

export interface ContinuityBenchmarkDecision {
  id: "blindReviewSamplesPerStratum" | "interRaterAgreementThreshold";
  approved: boolean;
  owner: string;
  rationale: string;
  approvedValue: number;
  decidedAt: string;
}

export interface ContinuityNarrativeEvidence {
  outlineAdherence: number;
  hookProseScore: number;
  continuityConflictsPer50k: number;
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
  narrativeEvidence: ContinuityNarrativeEvidence | null;
  decisions: readonly ContinuityBenchmarkDecision[];
}

export function buildContinuityBenchmarkReport(input: {
  fixture: ContinuityFixture;
  evaluation: ContinuityEvaluation;
  blindReviewPacket: BlindReviewPacket;
  blindReviewOracle: BlindReviewOracle;
  reviewEvidence: ContinuityReviewEvidence | null;
  decisions: readonly ContinuityBenchmarkDecision[];
  narrativeEvidence?: ContinuityNarrativeEvidence | null;
}): ContinuityBenchmarkReport {
  const blockers = new Set<string>();

  if (!input.fixture.plan.certificationEligible) {
    blockers.add("fixture-not-certification-eligible");
  }
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
  if (!input.narrativeEvidence) {
    blockers.add("narrative-evidence-missing");
  } else {
    if (
      !Number.isFinite(input.narrativeEvidence.outlineAdherence) ||
      input.narrativeEvidence.outlineAdherence < input.fixture.plan.thresholds.outlineAdherenceMin
    ) {
      blockers.add("narrative-outline-adherence-below-threshold");
    }
    if (
      !Number.isFinite(input.narrativeEvidence.hookProseScore) ||
      input.narrativeEvidence.hookProseScore < input.fixture.plan.thresholds.hookProseScoreMin
    ) {
      blockers.add("narrative-hook-prose-below-threshold");
    }
    if (
      !Number.isFinite(input.narrativeEvidence.continuityConflictsPer50k) ||
      input.narrativeEvidence.continuityConflictsPer50k >
        input.fixture.plan.thresholds.continuityConflictsPer50kMax
    ) {
      blockers.add("narrative-continuity-conflicts-above-threshold");
    }
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

  const reviewAssessment = input.reviewEvidence
    ? assessReviewEvidence({
        evidence: input.reviewEvidence,
        packet: input.blindReviewPacket,
      })
    : null;
  if (!input.reviewEvidence || !reviewAssessment) {
    blockers.add("blind-review-evidence-missing");
  } else {
    for (const blocker of reviewAssessment.blockers) {
      blockers.add(blocker);
    }
    const expectedSamples = approved.get("blindReviewSamplesPerStratum");
    const agreementThreshold = approved.get("interRaterAgreementThreshold");
    if (
      expectedSamples !== undefined &&
      input.reviewEvidence.samplesPerStratum !== expectedSamples
    ) {
      blockers.add("blind-review-sample-count-mismatch");
    }
    if (reviewAssessment.reviewedItemCount !== input.blindReviewPacket.items.length) {
      blockers.add("blind-review-items-incomplete");
    }
    if (reviewAssessment.reviewerIds.length < 2) {
      blockers.add("blind-review-reviewer-count-insufficient");
    }
    if (
      agreementThreshold !== undefined &&
      reviewAssessment.interRaterAgreement < agreementThreshold
    ) {
      blockers.add("blind-review-agreement-below-threshold");
    }
    if (reviewAssessment.adjudicatedDisagreements < reviewAssessment.disagreementCount) {
      blockers.add("blind-review-adjudication-missing");
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
      reviewedItemCount: reviewAssessment?.reviewedItemCount ?? 0,
      reviewerCount: reviewAssessment?.reviewerIds.length ?? 0,
      interRaterAgreement: reviewAssessment?.interRaterAgreement ?? null,
      adjudicatedDisagreements: reviewAssessment?.adjudicatedDisagreements ?? 0,
    },
    narrativeEvidence: input.narrativeEvidence ?? null,
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

function assessReviewEvidence(input: {
  evidence: ContinuityReviewEvidence;
  packet: BlindReviewPacket;
}): {
  blockers: readonly string[];
  reviewerIds: readonly string[];
  reviewedItemCount: number;
  interRaterAgreement: number;
  disagreementCount: number;
  adjudicatedDisagreements: number;
} {
  const blockers = new Set<string>();
  if (input.evidence.schemaVersion !== 1) {
    blockers.add("blind-review-evidence-schema-invalid");
  }
  if (input.evidence.packetSha256 !== input.packet.packetSha256) {
    blockers.add("blind-review-evidence-packet-mismatch");
  }
  if (input.evidence.rubricVersion !== input.packet.rubricVersion) {
    blockers.add("blind-review-rubric-mismatch");
  }

  const reviewerIds = [
    ...new Set(
      input.evidence.reviewers
        .filter(
          (reviewer) =>
            reviewer.kind === "human" &&
            reviewer.id.trim().length > 0 &&
            reviewer.displayName.trim().length > 0 &&
            reviewer.attestedAt.trim().length > 0,
        )
        .map((reviewer) => reviewer.id),
    ),
  ];
  const reviewerIdSet = new Set(reviewerIds);
  const packetReviewIds = new Set(input.packet.items.map((item) => item.reviewId));
  const scoresByReviewId = new Map<string, ContinuityReviewItemScore[]>();
  const scoreKeys = new Set<string>();

  for (const item of input.evidence.items) {
    const scoreKey = `${item.reviewId}:${item.reviewerId}`;
    if (
      !packetReviewIds.has(item.reviewId) ||
      !reviewerIdSet.has(item.reviewerId) ||
      scoreKeys.has(scoreKey) ||
      !isValidReviewItemScore(item)
    ) {
      blockers.add("blind-review-item-score-invalid");
      continue;
    }
    scoreKeys.add(scoreKey);
    scoresByReviewId.set(item.reviewId, [...(scoresByReviewId.get(item.reviewId) ?? []), item]);
  }

  let reviewedItemCount = 0;
  let agreedItemCount = 0;
  let disagreementCount = 0;
  const disagreements: string[] = [];
  for (const packetItem of input.packet.items) {
    const scores = scoresByReviewId.get(packetItem.reviewId) ?? [];
    const scoredReviewerIds = new Set(scores.map((score) => score.reviewerId));
    if (reviewerIds.every((reviewerId) => scoredReviewerIds.has(reviewerId))) {
      reviewedItemCount += 1;
    }
    const dispositions = new Set(scores.map((score) => score.disposition));
    if (dispositions.size === 1 && scores.length === reviewerIds.length) {
      agreedItemCount += 1;
    } else {
      disagreementCount += 1;
      disagreements.push(packetItem.reviewId);
    }
  }

  const validAdjudications = input.evidence.adjudications.filter(
    (adjudication) =>
      disagreements.includes(adjudication.reviewId) &&
      adjudication.adjudicatorId.trim().length > 0 &&
      adjudication.rationale.trim().length > 0 &&
      adjudication.adjudicatedAt.trim().length > 0 &&
      isValidDisposition(adjudication.decision),
  );
  const adjudicatedReviewIds = new Set(
    validAdjudications.map((adjudication) => adjudication.reviewId),
  );
  for (const stratum of ["early", "middle", "late"] as const) {
    const stratumReviewIds = input.packet.items
      .filter((item) => item.stratum === stratum)
      .map((item) => item.reviewId);
    if (
      stratumReviewIds.length !== input.evidence.samplesPerStratum ||
      stratumReviewIds.some(
        (reviewId) => (scoresByReviewId.get(reviewId) ?? []).length < reviewerIds.length,
      )
    ) {
      blockers.add("blind-review-samples-per-stratum-invalid");
    }
  }

  return {
    blockers: [...blockers],
    reviewerIds,
    reviewedItemCount,
    interRaterAgreement: reviewedItemCount === 0 ? 0 : agreedItemCount / input.packet.items.length,
    disagreementCount,
    adjudicatedDisagreements: adjudicatedReviewIds.size,
  };
}

function isValidReviewItemScore(score: ContinuityReviewItemScore): boolean {
  return (
    isValidDisposition(score.disposition) &&
    isRange(score.rubricScores.factualContinuity, 1, 5) &&
    isRange(score.rubricScores.knowledgeBoundary, 1, 5) &&
    isRange(score.rubricScores.narrativeCausality, 1, 5) &&
    isRange(score.rubricScores.outlineAdherence, 0, 1) &&
    isRange(score.rubricScores.hookProse, 1, 5) &&
    isRange(score.confidence, 0, 1) &&
    score.evidenceQuote.trim().length > 0 &&
    score.reviewedAt.trim().length > 0
  );
}

function isValidDisposition(value: string): value is ContinuityReviewDisposition {
  return value === "defect" || value === "no_defect" || value === "escalate";
}

function isRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
