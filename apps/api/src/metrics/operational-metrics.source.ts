import type { OperationalMetricsSnapshot } from "./prometheus-metrics.service";

export interface OperationalMetricsSource {
  collect(): Promise<OperationalMetricsSnapshot>;
}

export const OPERATIONAL_METRICS_SOURCE = Symbol("OPERATIONAL_METRICS_SOURCE");
