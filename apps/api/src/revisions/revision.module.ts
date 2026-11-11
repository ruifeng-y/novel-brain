import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WritingActionModule } from "../writing-actions/writing-action.module";
import { RevisionController } from "./revision.controller";
import { RevisionRepository } from "./revision.repository";
import { RevisionService } from "./revision.service";

@Module({
  imports: [AuthModule, WritingActionModule],
  controllers: [RevisionController],
  providers: [RevisionRepository, RevisionService],
})
export class RevisionModule {}
