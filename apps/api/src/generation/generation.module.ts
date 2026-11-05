import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GenerationController } from "./generation.controller";
import { GenerationQueue } from "./generation.queue";
import { GenerationRepository } from "./generation.repository";
import { GenerationService } from "./generation.service";

@Module({
  imports: [AuthModule],
  controllers: [GenerationController],
  providers: [GenerationRepository, GenerationQueue, GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
