import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { StoryPlanningController } from './story-planning.controller';
import { StoryPlanningService } from './story-planning.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StoryPlanningController],
  providers: [StoryPlanningService],
})
export class StoryPlanningModule {}
