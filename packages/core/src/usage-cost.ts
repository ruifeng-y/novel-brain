const PROMPT_COST_PER_TOKEN = 0.27 / 1_000_000;
const COMPLETION_COST_PER_TOKEN = 1.1 / 1_000_000;

export function estimateModelCost(promptTokens: number, completionTokens: number): number {
  return Number(
    (
      Math.max(0, promptTokens) * PROMPT_COST_PER_TOKEN +
      Math.max(0, completionTokens) * COMPLETION_COST_PER_TOKEN
    ).toFixed(6),
  );
}
