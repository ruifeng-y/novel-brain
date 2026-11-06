import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ReadinessModule } from "../readiness/readiness.module";
import { WorksController } from "./works.controller";
import { WorksRepository } from "./works.repository";
import { WorksService } from "./works.service";

@Module({
  imports: [AuthModule, ReadinessModule],
  controllers: [WorksController],
  providers: [WorksRepository, WorksService],
  exports: [WorksService],
})
export class WorksModule {}
