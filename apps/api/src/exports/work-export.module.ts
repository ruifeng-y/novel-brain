import { Module } from "@nestjs/common";
import { createObjectStorageFromEnvironment, OBJECT_STORAGE } from "@novel-brain/storage";

import { AuthModule } from "../auth/auth.module";
import { PublishPreviewController } from "./publish-preview.controller";
import { PublishPreviewRepository } from "./publish-preview.repository";
import { PublishPreviewService } from "./publish-preview.service";
import { WorkExportController } from "./work-export.controller";
import { WorkExportQueue } from "./work-export.queue";
import { WorkExportRepository } from "./work-export.repository";
import { WorkExportService } from "./work-export.service";

@Module({
  imports: [AuthModule],
  controllers: [WorkExportController, PublishPreviewController],
  providers: [
    PublishPreviewRepository,
    PublishPreviewService,
    WorkExportRepository,
    WorkExportQueue,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => createObjectStorageFromEnvironment(),
    },
    WorkExportService,
  ],
  exports: [WorkExportService],
})
export class WorkExportModule {}
