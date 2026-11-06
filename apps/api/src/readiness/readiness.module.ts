import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ReadinessController } from "./readiness.controller";
import { ReadinessRepository } from "./readiness.repository";
import { ReadinessService } from "./readiness.service";

@Module({
  imports: [AuthModule],
  controllers: [ReadinessController],
  providers: [ReadinessRepository, ReadinessService],
  exports: [ReadinessService],
})
export class ReadinessModule {}
