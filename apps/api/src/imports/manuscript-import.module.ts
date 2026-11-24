import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorksModule } from "../works/works.module";
import { ManuscriptImportController } from "./manuscript-import.controller";
import { ManuscriptImportQueue } from "./manuscript-import.queue";
import { ManuscriptImportRepository } from "./manuscript-import.repository";
import { ManuscriptImportService } from "./manuscript-import.service";

@Module({
  imports: [AuthModule, WorksModule],
  controllers: [ManuscriptImportController],
  providers: [ManuscriptImportQueue, ManuscriptImportRepository, ManuscriptImportService],
})
export class ManuscriptImportModule {}
