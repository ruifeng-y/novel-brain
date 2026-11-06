import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WritingActionController } from "./writing-action.controller";
import { WritingActionQueue } from "./writing-action.queue";
import { WritingActionRepository } from "./writing-action.repository";
import { WritingActionService } from "./writing-action.service";

@Module({
  imports: [AuthModule],
  controllers: [WritingActionController],
  providers: [WritingActionRepository, WritingActionQueue, WritingActionService],
  exports: [WritingActionService],
})
export class WritingActionModule {}
