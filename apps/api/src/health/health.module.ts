import { Module } from "@nestjs/common";

import { DatabaseProbeService } from "./database-probe.service";
import { HealthController } from "./health.controller";
import { DATABASE_PROBE, QUEUE_PROBE, STORAGE_PROBE } from "./health.probes";
import { HealthService } from "./health.service";
import { QueueProbeService } from "./queue-probe.service";
import { StorageProbeService } from "./storage-probe.service";

@Module({
  controllers: [HealthController],
  exports: [HealthService],
  providers: [
    HealthService,
    DatabaseProbeService,
    QueueProbeService,
    StorageProbeService,
    {
      provide: DATABASE_PROBE,
      useExisting: DatabaseProbeService,
    },
    {
      provide: QUEUE_PROBE,
      useExisting: QueueProbeService,
    },
    {
      provide: STORAGE_PROBE,
      useExisting: StorageProbeService,
    },
  ],
})
export class HealthModule {}
