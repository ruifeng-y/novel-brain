import { Injectable } from "@nestjs/common";
import {
  safeApiRouteTemplate,
  safeRuntimeMetricJobStatus,
  safeRuntimeMetricJobType,
  safeRuntimeMetricModelStatus,
} from "@novel-brain/core";

export interface QueueMetricCounts {
  wait: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

export interface OperationalMetricsSnapshot {
  dependencies: {
    database: boolean;
    queue: boolean;
    storage?: boolean;
  };
  queue: {
    counts: QueueMetricCounts;
    oldestAgeSeconds: Partial<Record<keyof QueueMetricCounts, number>>;
  };
  jobs: Array<{
    jobType: string;
    status: string;
    count: number;
  }>;
  modelCalls: Array<{
    status: string;
    count: number;
    averageLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costCny: number;
  }>;
  storage: {
    configured: boolean;
    available: boolean;
  };
}

interface HistogramSeries {
  labels: Record<string, string>;
  buckets: number[];
  count: number;
  sum: number;
}

const REQUEST_BUCKETS = [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10];

@Injectable()
export class PrometheusMetricsService {
  private snapshot: OperationalMetricsSnapshot | undefined;
  private readonly requestHistogram = new Map<string, HistogramSeries>();

  observeHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = {
      method: /^[A-Z]+$/u.test(method) ? method : "OTHER",
      route: safeApiRouteTemplate(route),
      status: /^[1-5]\d{2}$/u.test(String(status)) ? String(status) : "unknown",
    };
    const key = JSON.stringify(labels);
    const series = this.requestHistogram.get(key) ?? {
      labels,
      buckets: REQUEST_BUCKETS.map(() => 0),
      count: 0,
      sum: 0,
    };
    const duration = Math.max(0, durationSeconds);
    series.count += 1;
    series.sum += duration;
    REQUEST_BUCKETS.forEach((bucket, index) => {
      if (duration <= bucket) {
        series.buckets[index] = (series.buckets[index] ?? 0) + 1;
      }
    });
    this.requestHistogram.set(key, series);
  }

  updateSnapshot(snapshot: OperationalMetricsSnapshot): void {
    this.snapshot = snapshot;
  }

  async render(): Promise<string> {
    const lines: string[] = [];
    this.renderRequestHistogram(lines);
    if (this.snapshot) {
      this.renderSnapshot(lines, this.snapshot);
    }
    return `${lines.join("\n")}\n`;
  }

  private renderRequestHistogram(lines: string[]): void {
    lines.push(
      "# HELP novelbrain_api_request_duration_seconds API request duration in seconds.",
      "# TYPE novelbrain_api_request_duration_seconds histogram",
    );
    for (const series of this.requestHistogram.values()) {
      REQUEST_BUCKETS.forEach((bucket, index) => {
        lines.push(
          metricLine(
            "novelbrain_api_request_duration_seconds_bucket",
            { ...series.labels, le: String(bucket) },
            series.buckets[index] ?? 0,
          ),
        );
      });
      lines.push(
        metricLine(
          "novelbrain_api_request_duration_seconds_bucket",
          { ...series.labels, le: "+Inf" },
          series.count,
        ),
        metricLine("novelbrain_api_request_duration_seconds_sum", series.labels, series.sum),
        metricLine("novelbrain_api_request_duration_seconds_count", series.labels, series.count),
      );
    }
  }

  private renderSnapshot(lines: string[], snapshot: OperationalMetricsSnapshot): void {
    lines.push(
      "# HELP novelbrain_dependency_up Whether an operational dependency is available.",
      "# TYPE novelbrain_dependency_up gauge",
    );
    for (const [dependency, available] of Object.entries(snapshot.dependencies)) {
      lines.push(metricLine("novelbrain_dependency_up", { dependency }, available ? 1 : 0));
    }

    lines.push(
      "# HELP novelbrain_worker_queue_jobs Current BullMQ jobs by queue state.",
      "# TYPE novelbrain_worker_queue_jobs gauge",
    );
    for (const [state, count] of Object.entries(snapshot.queue.counts)) {
      lines.push(metricLine("novelbrain_worker_queue_jobs", { state }, count));
    }

    lines.push(
      "# HELP novelbrain_worker_queue_oldest_job_age_seconds Age of the oldest waiting queue job.",
      "# TYPE novelbrain_worker_queue_oldest_job_age_seconds gauge",
    );
    for (const [state, age] of Object.entries(snapshot.queue.oldestAgeSeconds)) {
      if (age !== undefined) {
        lines.push(metricLine("novelbrain_worker_queue_oldest_job_age_seconds", { state }, age));
      }
    }

    lines.push(
      "# HELP novelbrain_jobs_24h Durable generation jobs in the rolling 24-hour window.",
      "# TYPE novelbrain_jobs_24h gauge",
    );
    for (const job of snapshot.jobs) {
      const jobType = safeRuntimeMetricJobType(job.jobType);
      const status = safeRuntimeMetricJobStatus(job.status);
      lines.push(metricLine("novelbrain_jobs_24h", { job_type: jobType, status }, job.count));
    }

    lines.push(
      "# HELP novelbrain_model_calls_24h Model calls in the rolling 24-hour window.",
      "# TYPE novelbrain_model_calls_24h gauge",
      "# HELP novelbrain_model_latency_ms Average model call latency in the rolling 24-hour window.",
      "# TYPE novelbrain_model_latency_ms gauge",
      "# HELP novelbrain_model_cost_cny_24h Settled model cost in CNY in the rolling 24-hour window.",
      "# TYPE novelbrain_model_cost_cny_24h gauge",
    );
    let inputTokens = 0;
    let outputTokens = 0;
    let modelCalls = 0;
    let latencyWeighted = 0;
    for (const call of snapshot.modelCalls) {
      const status = safeRuntimeMetricModelStatus(call.status);
      inputTokens += call.inputTokens;
      outputTokens += call.outputTokens;
      modelCalls += call.count;
      latencyWeighted += call.averageLatencyMs * call.count;
      lines.push(
        metricLine("novelbrain_model_calls_24h", { status }, call.count),
        metricLine("novelbrain_model_latency_ms", { status }, call.averageLatencyMs),
        metricLine("novelbrain_model_cost_cny_24h", { status }, call.costCny),
      );
    }
    lines.push(
      "# HELP novelbrain_model_tokens_24h Model tokens in the rolling 24-hour window.",
      "# TYPE novelbrain_model_tokens_24h gauge",
      metricLine("novelbrain_model_tokens_24h", { kind: "input" }, inputTokens),
      metricLine("novelbrain_model_tokens_24h", { kind: "output" }, outputTokens),
      "# HELP novelbrain_model_latency_ms_overall Weighted average model latency in the rolling 24-hour window.",
      "# TYPE novelbrain_model_latency_ms_overall gauge",
      metricLine(
        "novelbrain_model_latency_ms_overall",
        {},
        modelCalls > 0 ? latencyWeighted / modelCalls : 0,
      ),
      "# HELP novelbrain_storage_configured Whether object storage metrics are configured.",
      "# TYPE novelbrain_storage_configured gauge",
      metricLine("novelbrain_storage_configured", {}, snapshot.storage.configured ? 1 : 0),
      "# HELP novelbrain_storage_available Whether the configured object storage is reachable.",
      "# TYPE novelbrain_storage_available gauge",
      metricLine("novelbrain_storage_available", {}, snapshot.storage.available ? 1 : 0),
    );
  }
}

function metricLine(name: string, labels: Record<string, string>, value: number): string {
  const renderedLabels = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, label]) => `${key}="${escapeLabel(label)}"`)
    .join(",");
  return `${name}${renderedLabels ? `{${renderedLabels}}` : ""} ${value}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}
