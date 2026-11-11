import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ChaptersModule } from "../chapters/chapters.module";
import { OutlineController } from "./outline.controller";
import { OutlineRepository } from "./outline.repository";
import { OutlineService } from "./outline.service";

@Module({
  imports: [AuthModule, ChaptersModule],
  controllers: [OutlineController],
  providers: [OutlineRepository, OutlineService],
  exports: [OutlineService],
})
export class OutlineModule {}
