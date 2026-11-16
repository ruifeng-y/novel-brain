import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorkExportController } from "./work-export.controller";
import { WorkExportQueue } from "./work-export.queue";
import { WorkExportRepository } from "./work-export.repository";
import { WorkExportService } from "./work-export.service";

@Module({
  imports: [AuthModule],
  controllers: [WorkExportController],
  providers: [WorkExportRepository, WorkExportQueue, WorkExportService],
  exports: [WorkExportService],
})
export class WorkExportModule {}
