import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { HealthModule } from "../health/health.module";
import { MetricsController } from "./metrics.controller";
import { MetricsDatabaseService, METRICS_POOL } from "./metrics-database.service";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsPoolService, MetricsQueueConnectionService } from "./metrics-clients";
import { METRICS_QUEUE_CLIENT, MetricsQueueService } from "./metrics-queue.service";
import {
  METRICS_DATABASE,
  METRICS_QUEUE,
  OperationalMetricsCollector,
} from "./operational-metrics.collector";
import { OPERATIONAL_METRICS_SOURCE } from "./operational-metrics.source";
import { PrometheusMetricsService } from "./prometheus-metrics.service";

@Module({
  imports: [HealthModule],
  controllers: [MetricsController],
  providers: [
    PrometheusMetricsService,
    OperationalMetricsCollector,
    MetricsDatabaseService,
    MetricsQueueService,
    MetricsPoolService,
    MetricsQueueConnectionService,
    {
      provide: METRICS_POOL,
      useFactory: (service: MetricsPoolService) => service.pool,
      inject: [MetricsPoolService],
    },
    {
      provide: METRICS_QUEUE_CLIENT,
      useFactory: (service: MetricsQueueConnectionService) => service.queue,
      inject: [MetricsQueueConnectionService],
    },
    { provide: METRICS_DATABASE, useExisting: MetricsDatabaseService },
    { provide: METRICS_QUEUE, useExisting: MetricsQueueService },
    { provide: OPERATIONAL_METRICS_SOURCE, useExisting: OperationalMetricsCollector },
  ],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
