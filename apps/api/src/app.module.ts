import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AiModule } from './ai/ai.module';
import { ModelConfigsController } from './ai/model-configs.controller';
import { AuthModule } from './auth/auth.module';
import { AuthController } from './auth/auth.controller';
import { CharactersController } from './characters/characters.controller';
import { CharactersModule } from './characters/characters.module';
import { DatabaseModule } from './database/database.module';
import { EntitiesController } from './entities/entities.controller';
import { EntitiesModule } from './entities/entities.module';
import { ChapterGenerationController } from './generation/chapter-generation.controller';
import { ChapterGenerationModule } from './generation/chapter-generation.module';
import { HealthModule } from './health/health.module';
import { HistoryController } from './history/history.controller';
import { HistoryModule } from './history/history.module';
import { MapsController } from './maps/maps.controller';
import { MapsModule } from './maps/maps.module';
import { OutlineController } from './planning/outline.controller';
import { RedisModule } from './redis/redis.module';
import { validateEnv } from './config/env';
import { StoryPlanningController } from './planning/story-planning.controller';
import { StoryPlanningModule } from './planning/story-planning.module';
import { StoryLedgerController } from './planning/story-ledger.controller';
import { WorksController } from './works/works.controller';
import { WorksModule } from './works/works.module';
import { WorldbuildingController } from './worldbuilding/worldbuilding.controller';
import { WorldbuildingModule } from './worldbuilding/worldbuilding.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    AiModule,
    WorksModule,
    StoryPlanningModule,
    EntitiesModule,
    MapsModule,
    WorldbuildingModule,
    CharactersModule,
    ChapterGenerationModule,
    HistoryModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(cookieParser())
      .forRoutes(
        AuthController,
        WorksController,
        ModelConfigsController,
        OutlineController,
        StoryPlanningController,
        StoryLedgerController,
        EntitiesController,
        MapsController,
        WorldbuildingController,
        HistoryController,
        CharactersController,
        ChapterGenerationController,
      );
  }
}
