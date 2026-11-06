import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ReadinessModule } from "../readiness/readiness.module";
import { ChaptersController } from "./chapters.controller";
import { ChaptersRepository } from "./chapters.repository";
import { ChaptersService } from "./chapters.service";

@Module({
  imports: [AuthModule, ReadinessModule],
  controllers: [ChaptersController],
  providers: [ChaptersRepository, ChaptersService],
  exports: [ChaptersService],
})
export class ChaptersModule {}
