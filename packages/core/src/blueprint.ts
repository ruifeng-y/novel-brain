import {
  type BlueprintEstimate,
  type BlueprintStatus,
  type WorkGenre,
  type WorkScaleTarget,
} from "@novel-brain/contracts";

export interface BlueprintEstimateInput {
  genre: WorkGenre;
  scaleTarget: WorkScaleTarget;
  chapterLengthTarget: number;
  modelRatePerTokenCny?: number;
}

// Initial blueprint candidates are intentionally bounded by ADR 0029 and the
// blueprint bootstrap spec, not the eventual full-book V1 capacity target.
export const BLUEPRINT_SCALE_PLAN = {
  short: { volumes: 1, chapters: 12, scenes: 24, baseTokens: 40_000 },
  medium: { volumes: 3, chapters: 36, scenes: 72, baseTokens: 100_000 },
  long: { volumes: 5, chapters: 60, scenes: 120, baseTokens: 180_000 },
  epic: { volumes: 8, chapters: 96, scenes: 192, baseTokens: 300_000 },
} as const;

export const M0_COST_PER_TOKEN_CNY = 0.000002;

const BLUEPRINT_STATUS_TRANSITIONS: Record<BlueprintStatus, BlueprintStatus[]> = {
  queued: ["running", "waiting_model_config", "failed", "cancelled"],
  running: ["waiting_model_config", "budget_paused", "waiting_review", "failed", "cancelled"],
  waiting_model_config: ["queued", "failed", "cancelled"],
  budget_paused: ["queued", "failed", "cancelled"],
  waiting_review: ["confirmed", "failed", "cancelled"],
  failed: ["queued", "cancelled"],
  confirmed: [],
  cancelled: [],
};

export function canTransitionBlueprintStatus(from: BlueprintStatus, to: BlueprintStatus): boolean {
  return BLUEPRINT_STATUS_TRANSITIONS[from].includes(to);
}

export function estimateBlueprint(input: BlueprintEstimateInput): BlueprintEstimate {
  const scale = BLUEPRINT_SCALE_PLAN[input.scaleTarget];
  const chapterLengthFactor = Math.max(
    0.8,
    Math.min(1.5, 1 + (input.chapterLengthTarget - 3000) / 10_000),
  );
  const estimatedTokens = Math.round(scale.baseTokens * chapterLengthFactor);
  const usesFallbackRate = input.modelRatePerTokenCny === undefined;
  const modelRatePerTokenCny = input.modelRatePerTokenCny ?? M0_COST_PER_TOKEN_CNY;
  const estimatedCostCny = estimatedTokens * modelRatePerTokenCny;
  return {
    ruleVersion: "blueprint-estimate-v1",
    planned: {
      volumes: scale.volumes,
      chapters: scale.chapters,
      scenes: scale.scenes,
    },
    estimatedTokens,
    estimatedCostCny,
    defaultBudget: {
      maxTokens: Math.ceil((estimatedTokens * 1.2) / 1000) * 1000,
      maxCostCny: roundUpToFiveJiao(estimatedCostCny * 1.5),
    },
    assumptions: [
      `按${input.genre}题材和${input.scaleTarget}规模估算`,
      `章节字数目标 ${input.chapterLengthTarget}`,
      ...(usesFallbackRate ? ["模型价格不可用，按当前默认单价估算"] : []),
    ],
  };
}

function roundUpToFiveJiao(value: number): number {
  return Math.max(0.5, Math.ceil(value / 0.5) * 0.5);
}
