export interface RawSample {
  durationMs: number;
  ok: boolean;
}

export interface SampleSummary {
  count: number;
  okCount: number;
  errorCount: number;
  errorRate: number | null;
  errorsPerSecond: number;
  throughputPerSecond: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export function summarizeSamples(samples: readonly RawSample[], elapsedMs: number): SampleSummary {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error("ELAPSED_MS_INVALID");
  }
  const durations = samples
    .map((sample) => sample.durationMs)
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((left, right) => left - right);
  const errorCount = samples.filter((sample) => !sample.ok).length;
  const elapsedSeconds = elapsedMs / 1_000;
  return {
    count: samples.length,
    okCount: samples.length - errorCount,
    errorCount,
    errorRate: samples.length === 0 ? null : errorCount / samples.length,
    errorsPerSecond: elapsedSeconds === 0 ? 0 : errorCount / elapsedSeconds,
    throughputPerSecond: elapsedSeconds === 0 ? 0 : samples.length / elapsedSeconds,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
  };
}

export function percentile(sortedValues: readonly number[], quantile: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  if (!(quantile > 0 && quantile <= 1)) {
    throw new Error("QUANTILE_INVALID");
  }
  const rank = Math.max(1, Math.ceil(quantile * sortedValues.length));
  return sortedValues[rank - 1] ?? null;
}
