import { continuityScenarioFamilies } from "./families";

export {
  continuityControlFamilies,
  continuityDefectFamilies,
  continuityScenarioFamilies,
  continuityScenarioMetadata,
} from "./families";
export type {
  ContinuityControlFamily,
  ContinuityDefectFamily,
  ContinuityScenarioFamily,
  ContinuitySeverity,
} from "./families";
export type ContinuityTier = "smoke" | "minimum" | "full" | "maximum";

export interface ContinuityThresholds {
  p0FactLossMax: 0;
  knowledgeBoundaryViolationMax: 0;
  outlineAdherenceMin: 0.9;
  hookProseScoreMin: 4;
  continuityConflictsPer50kMax: 1;
}

export interface ContinuityPlan {
  generatorVersion: "continuity-benchmark-v1";
  schemaVersion: 1;
  seed: number;
  tier: ContinuityTier;
  rubricVersion: "adr-0022-v1";
  chapterCount: number;
  volumeCount: number;
  chaptersPerVolume: number;
  branchDivergenceChapters: readonly number[];
  scenarioFamilies: typeof continuityScenarioFamilies;
  thresholds: ContinuityThresholds;
  certificationEligible: boolean;
  decisionRequired: readonly string[];
}

const topologies: Record<ContinuityTier, { chapterCount: number; volumeCount: number }> = {
  smoke: { chapterCount: 12, volumeCount: 3 },
  minimum: { chapterCount: 3_000, volumeCount: 30 },
  full: { chapterCount: 3_500, volumeCount: 35 },
  maximum: { chapterCount: 4_000, volumeCount: 40 },
};

const branchFractions = [0.0857142857, 0.5, 0.9142857143] as const;

export function createContinuityPlan(input: {
  seed: number;
  tier: ContinuityTier;
}): ContinuityPlan {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("SEED_INVALID");
  }
  const topology = topologies[input.tier];
  if (!topology) {
    throw new Error("TIER_INVALID");
  }
  const chaptersPerVolume = topology.chapterCount / topology.volumeCount;
  if (!Number.isInteger(chaptersPerVolume)) {
    throw new Error("VOLUME_TOPOLOGY_INVALID");
  }

  return {
    generatorVersion: "continuity-benchmark-v1",
    schemaVersion: 1,
    seed: input.seed,
    tier: input.tier,
    rubricVersion: "adr-0022-v1",
    chapterCount: topology.chapterCount,
    volumeCount: topology.volumeCount,
    chaptersPerVolume,
    branchDivergenceChapters: branchFractions.map((fraction) =>
      Math.max(1, Math.min(topology.chapterCount, Math.round(topology.chapterCount * fraction))),
    ),
    scenarioFamilies: continuityScenarioFamilies,
    thresholds: {
      p0FactLossMax: 0,
      knowledgeBoundaryViolationMax: 0,
      outlineAdherenceMin: 0.9,
      hookProseScoreMin: 4,
      continuityConflictsPer50kMax: 1,
    },
    certificationEligible: input.tier !== "smoke",
    decisionRequired: ["blindReviewSamplesPerStratum", "interRaterAgreementThreshold"],
  };
}
