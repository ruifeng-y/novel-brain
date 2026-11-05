import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { StoryBibleController } from "./story-bible.controller";
import { StoryBibleGenerator } from "./story-bible.generator";
import { StoryBibleRepository } from "./story-bible.repository";
import { StoryBibleService } from "./story-bible.service";

@Module({
  imports: [AuthModule],
  controllers: [StoryBibleController],
  providers: [StoryBibleGenerator, StoryBibleRepository, StoryBibleService],
  exports: [StoryBibleService],
})
export class StoryBibleModule {}
