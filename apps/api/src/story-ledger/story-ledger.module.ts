import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { StoryLedgerController } from "./story-ledger.controller";
import { StoryLedgerRepository } from "./story-ledger.repository";
import { StoryLedgerService } from "./story-ledger.service";

@Module({
  imports: [AuthModule],
  controllers: [StoryLedgerController],
  providers: [StoryLedgerRepository, StoryLedgerService],
  exports: [StoryLedgerService],
})
export class StoryLedgerModule {}
