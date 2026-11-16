import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";

import { OPERATIONAL_METRICS_SOURCE } from "./operational-metrics.source";
import type { OperationalMetricsSource } from "./operational-metrics.source";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrometheusMetricsService } from "./prometheus-metrics.service";

@Controller("metrics")
@ApiExcludeController()
export class MetricsController {
  constructor(
    private readonly metrics: PrometheusMetricsService,
    @Inject(OPERATIONAL_METRICS_SOURCE)
    private readonly source: OperationalMetricsSource,
  ) {}

  @Get()
  async getMetrics(@Res({ passthrough: true }) response: Response): Promise<string> {
    this.metrics.updateSnapshot(await this.source.collect());
    response.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return this.metrics.render();
  }
}
