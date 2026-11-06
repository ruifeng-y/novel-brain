export const CONTEXT_TOKEN_ESTIMATOR = "cjk_chars_per_2";

export function estimateContextTokens(value: string): number {
  return Math.max(1, Math.ceil(Array.from(value.replace(/\s/gu, "")).length / 2));
}
