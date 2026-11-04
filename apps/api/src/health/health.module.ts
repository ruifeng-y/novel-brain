import { Module } from "@nestjs/common";

import { DatabaseProbeService } from "./database-probe.service";
import { HealthController } from "./health.controller";
import { DATABASE_PROBE, QUEUE_PROBE } from "./health.probes";
import { HealthService } from "./health.service";
import { QueueProbeService } from "./queue-probe.service";

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    DatabaseProbeService,
    QueueProbeService,
    {
      provide: DATABASE_PROBE,
      useExisting: DatabaseProbeService,
    },
    {
      provide: QUEUE_PROBE,
      useExisting: QueueProbeService,
    },
  ],
})
export class HealthModule {}
