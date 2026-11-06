import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ReadinessModule } from "../readiness/readiness.module";
import { GenerationController } from "./generation.controller";
import { GenerationQueue } from "./generation.queue";
import { GenerationRepository } from "./generation.repository";
import { GenerationService } from "./generation.service";

@Module({
  imports: [AuthModule, ReadinessModule],
  controllers: [GenerationController],
  providers: [GenerationRepository, GenerationQueue, GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
