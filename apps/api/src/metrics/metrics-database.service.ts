import { Inject, Injectable } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import type { DurableMetricsSource } from "./operational-metrics.collector";

export const METRICS_POOL = Symbol("METRICS_POOL");

interface MetricsQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<Row>>;
}

interface JobRow {
  type: string;
  status: string;
  count: number;
}

interface ModelCallRow {
  status: string;
  count: number;
  average_latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_cny: number;
}

@Injectable()
export class MetricsDatabaseService implements DurableMetricsSource {
  constructor(@Inject(METRICS_POOL) private readonly pool: MetricsQueryable) {}

  async collect(): Promise<Awaited<ReturnType<DurableMetricsSource["collect"]>>> {
    const [jobs, modelCalls] = await Promise.all([
      this.pool.query<JobRow>(
        `SELECT type, status, count(*)::int AS count
         FROM jobs
         WHERE created_at >= now() - interval '24 hours'
         GROUP BY type, status`,
      ),
      this.pool.query<ModelCallRow>(
        `SELECT status,
                count(*)::int AS count,
                COALESCE(avg(latency_ms), 0)::float8 AS average_latency_ms,
                COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
                COALESCE(sum(cost_cny), 0)::float8 AS cost_cny
         FROM model_calls
         WHERE created_at >= now() - interval '24 hours'
         GROUP BY status`,
      ),
    ]);

    return {
      jobs: jobs.rows.map((row) => ({
        jobType: row.type,
        status: row.status,
        count: Number(row.count),
      })),
      modelCalls: modelCalls.rows.map((row) => ({
        status: row.status,
        count: Number(row.count),
        averageLatencyMs: Number(row.average_latency_ms),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        costCny: Number(row.cost_cny),
      })),
    };
  }
}
