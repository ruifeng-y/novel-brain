import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BatchPlanController } from "./batch-plan.controller";
import { BatchPlanQueue } from "./batch-plan.queue";
import { BatchPlanRepository } from "./batch-plan.repository";
import { BatchPlanService } from "./batch-plan.service";

@Module({
  imports: [AuthModule],
  controllers: [BatchPlanController],
  providers: [BatchPlanRepository, BatchPlanQueue, BatchPlanService],
})
export class BatchPlanModule {}
