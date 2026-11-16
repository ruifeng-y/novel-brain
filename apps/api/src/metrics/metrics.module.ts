import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { HealthModule } from "../health/health.module";
import { MetricsController } from "./metrics.controller";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsQueueConnectionService, MetricsRuntimeRedisService } from "./metrics-clients";
import { METRICS_QUEUE_CLIENT, MetricsQueueService } from "./metrics-queue.service";
import { METRICS_REDIS, MetricsRuntimeService } from "./metrics-runtime.service";
import {
  METRICS_QUEUE,
  METRICS_RUNTIME,
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
    MetricsQueueService,
    MetricsRuntimeService,
    MetricsRuntimeRedisService,
    MetricsQueueConnectionService,
    {
      provide: METRICS_REDIS,
      useFactory: (service: MetricsRuntimeRedisService) => service.redis,
      inject: [MetricsRuntimeRedisService],
    },
    {
      provide: METRICS_QUEUE_CLIENT,
      useFactory: (service: MetricsQueueConnectionService) => service.queue,
      inject: [MetricsQueueConnectionService],
    },
    { provide: METRICS_RUNTIME, useExisting: MetricsRuntimeService },
    { provide: METRICS_QUEUE, useExisting: MetricsQueueService },
    { provide: OPERATIONAL_METRICS_SOURCE, useExisting: OperationalMetricsCollector },
  ],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
