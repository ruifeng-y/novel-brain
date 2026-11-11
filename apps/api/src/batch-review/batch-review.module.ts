import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BatchPlanModule } from "../batch-plan/batch-plan.module";
import { BatchReviewController } from "./batch-review.controller";
import { BatchReviewRepository } from "./batch-review.repository";
import { BatchReviewService } from "./batch-review.service";

@Module({
  imports: [AuthModule, BatchPlanModule],
  controllers: [BatchReviewController],
  providers: [BatchReviewRepository, BatchReviewService],
})
export class BatchReviewModule {}
