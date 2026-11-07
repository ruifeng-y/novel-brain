import { estimateContextTokens } from "./context-tokens";

export const PROVIDER_CALL_MAX_OUTPUT_TOKENS = 2_000;

export interface ProviderCallBudget {
  promptTokens: number;
  maxOutputTokens: number;
  reservedTokens: number;
}

export function planProviderCallBudget(input: {
  system: string;
  prompt: string;
  maxOutputTokens: number;
}): ProviderCallBudget {
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0) {
    throw new RangeError("maxOutputTokens must be a positive integer");
  }
  const promptTokens = estimateContextTokens(`${input.system}${input.prompt}`);
  return {
    promptTokens,
    maxOutputTokens: input.maxOutputTokens,
    reservedTokens: promptTokens + input.maxOutputTokens,
  };
}
