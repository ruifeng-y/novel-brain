export type BatchBudgetBindingScope = "chapter" | "volume" | "task" | "per_ten_thousand_characters";

export interface BatchBudgetAllocationInput {
  chapterMaxCostCny: number;
  volumeMaxCostCny: number | null;
  taskMaxCostCny: number | null;
  perTenThousandCharsMaxCostCny: number | null;
  projectedCharacters: number;
  taskCostUsedCny: number;
  volumeCostUsedCny: number;
}

export interface BatchBudgetAllocation {
  allowedCostCny: number;
  bindingScope: BatchBudgetBindingScope;
  projectedCharacters: number;
  perTenThousandCharactersLimitCny: number | null;
}

export function calculateBatchBudgetAllocation(
  input: BatchBudgetAllocationInput,
): BatchBudgetAllocation {
  const projectedCharacters = Math.max(0, input.projectedCharacters);
  const perTenThousandCharactersLimitCny =
    input.perTenThousandCharsMaxCostCny === null
      ? null
      : roundCost((projectedCharacters / 10_000) * input.perTenThousandCharsMaxCostCny);
  const candidates: Array<{ scope: BatchBudgetBindingScope; remaining: number }> = [
    { scope: "task", remaining: subtractLimit(input.taskMaxCostCny, input.taskCostUsedCny) },
    { scope: "volume", remaining: subtractLimit(input.volumeMaxCostCny, input.volumeCostUsedCny) },
    {
      scope: "per_ten_thousand_characters",
      remaining: subtractLimit(perTenThousandCharactersLimitCny, input.taskCostUsedCny),
    },
    { scope: "chapter", remaining: input.chapterMaxCostCny },
  ];
  candidates.sort((left, right) => left.remaining - right.remaining);
  const binding = candidates[0]!;
  return {
    allowedCostCny: Math.max(0, roundCost(binding.remaining)),
    bindingScope: binding.scope,
    projectedCharacters,
    perTenThousandCharactersLimitCny,
  };
}

function subtractLimit(limit: number | null, used: number): number {
  return limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}
