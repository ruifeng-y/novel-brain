import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SummariesController } from "./summaries.controller";
import { SummaryRebuildQueue } from "./summaries.queue";
import { SummariesRepository } from "./summaries.repository";
import { SummariesService } from "./summaries.service";

@Module({
  imports: [AuthModule],
  controllers: [SummariesController],
  providers: [SummariesRepository, SummaryRebuildQueue, SummariesService],
})
export class SummariesModule {}
