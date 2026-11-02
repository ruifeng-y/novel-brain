import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { OutlineController } from './outline.controller';
import { OutlineService } from './outline.service';
import { StoryPlanningController } from './story-planning.controller';
import { StoryPlanningService } from './story-planning.service';
import { StoryLedgerController } from './story-ledger.controller';
import { StoryLedgerService } from './story-ledger.service';

@Module({
  imports: [DatabaseModule, AuthModule, AiModule],
  controllers: [StoryPlanningController, OutlineController, StoryLedgerController],
  providers: [StoryPlanningService, OutlineService, StoryLedgerService],
})
export class StoryPlanningModule {}
