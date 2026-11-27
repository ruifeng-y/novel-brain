import type { BlueprintCost } from "@novel-brain/contracts";

export function addBlueprintCost(left: BlueprintCost, right: BlueprintCost): BlueprintCost {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costCny: left.costCny + right.costCny,
  };
}
