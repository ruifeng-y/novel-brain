import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { OutlineController } from './outline.controller';
import { OutlineService } from './outline.service';
import { StoryPlanningController } from './story-planning.controller';
import { StoryPlanningService } from './story-planning.service';

@Module({
  imports: [DatabaseModule, AuthModule, AiModule],
  controllers: [StoryPlanningController, OutlineController],
  providers: [StoryPlanningService, OutlineService],
})
export class StoryPlanningModule {}
