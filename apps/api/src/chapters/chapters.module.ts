import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ChaptersController } from "./chapters.controller";
import { ChaptersRepository } from "./chapters.repository";
import { ChaptersService } from "./chapters.service";

@Module({
  imports: [AuthModule],
  controllers: [ChaptersController],
  providers: [ChaptersRepository, ChaptersService],
  exports: [ChaptersService],
})
export class ChaptersModule {}
