import type { BlueprintEstimate } from "@novel-brain/contracts";

export type BlueprintScaleTarget = "short" | "medium" | "long" | "epic";

export interface BlueprintEstimateInput {
  genre: "xianxia" | "history" | "urban";
  scaleTarget: BlueprintScaleTarget;
  chapterLengthTarget: number;
  modelRatePerTokenCny?: number;
}

const SCALE = {
  short: { volumes: 1, chapters: 12, scenes: 24, baseTokens: 40_000 },
  medium: { volumes: 3, chapters: 36, scenes: 72, baseTokens: 100_000 },
  long: { volumes: 5, chapters: 60, scenes: 120, baseTokens: 180_000 },
  epic: { volumes: 8, chapters: 96, scenes: 192, baseTokens: 300_000 },
} as const;

const FALLBACK_MODEL_RATE_PER_TOKEN_CNY = 0.000002;

export function estimateBlueprint(input: BlueprintEstimateInput): BlueprintEstimate {
  const scale = SCALE[input.scaleTarget];
  const chapterLengthFactor = Math.max(
    0.8,
    Math.min(1.5, 1 + (input.chapterLengthTarget - 3000) / 10_000),
  );
  const estimatedTokens = Math.round(scale.baseTokens * chapterLengthFactor);
  const modelRatePerTokenCny = input.modelRatePerTokenCny ?? FALLBACK_MODEL_RATE_PER_TOKEN_CNY;
  const estimatedCostCny = roundMoney(estimatedTokens * modelRatePerTokenCny);
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
    ],
  };
}

function roundUpToFiveJiao(value: number): number {
  return Math.max(0.5, Math.ceil(value / 0.5) * 0.5);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(4));
}
