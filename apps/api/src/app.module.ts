import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AiModule } from './ai/ai.module';
import { ModelConfigsController } from './ai/model-configs.controller';
import { AuthModule } from './auth/auth.module';
import { AuthController } from './auth/auth.controller';
import { BranchesController } from './branches/branches.controller';
import { BranchesModule } from './branches/branches.module';
import { BranchBaselineInterceptor } from './branches/branch-baseline.interceptor';
import { BranchStateModule } from './branches/branch-state.module';
import { CharactersController } from './characters/characters.controller';
import { CharactersModule } from './characters/characters.module';
import { ChangesController } from './changes/changes.controller';
import { ChangesModule } from './changes/changes.module';
import { DatabaseModule } from './database/database.module';
import { EntitiesController } from './entities/entities.controller';
import { EntitiesModule } from './entities/entities.module';
import { ExportsController } from './exports/exports.controller';
import { ExportsModule } from './exports/exports.module';
import { BatchJobsController } from './generation/batch-jobs.controller';
import { ChapterGenerationController } from './generation/chapter-generation.controller';
import { ChapterGenerationModule } from './generation/chapter-generation.module';
import { HealthModule } from './health/health.module';
import { HistoryController } from './history/history.controller';
import { HistoryModule } from './history/history.module';
import { MapsController } from './maps/maps.controller';
import { MapsModule } from './maps/maps.module';
import { OutlineController } from './planning/outline.controller';
import { RedisModule } from './redis/redis.module';
import { SearchController } from './search/search.controller';
import { SearchModule } from './search/search.module';
import { validateEnv } from './config/env';
import { StoryPlanningController } from './planning/story-planning.controller';
import { StoryPlanningModule } from './planning/story-planning.module';
import { StoryLedgerController } from './planning/story-ledger.controller';
import { TenantContextInterceptor } from './security/tenant-context.interceptor';
import { SecurityModule } from './security/security.module';
import { UsersController } from './users/users.controller';
import { UsersModule } from './users/users.module';
import { WorksController } from './works/works.controller';
import { WorksModule } from './works/works.module';
import { WorldbuildingController } from './worldbuilding/worldbuilding.controller';
import { WorldbuildingModule } from './worldbuilding/worldbuilding.module';
import { VersionCaptureInterceptor } from './versions/version-capture.interceptor';
import { VersionsController } from './versions/versions.controller';
import { VersionsModule } from './versions/versions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    SecurityModule,
    AuthModule,
    AiModule,
    WorksModule,
    BranchStateModule,
    VersionsModule,
    BranchesModule,
    StoryPlanningModule,
    EntitiesModule,
    MapsModule,
    WorldbuildingModule,
    CharactersModule,
    ChangesModule,
    ChapterGenerationModule,
    ExportsModule,
    HistoryModule,
    UsersModule,
    SearchModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: BranchBaselineInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: VersionCaptureInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(cookieParser())
      .forRoutes(
        AuthController,
        UsersController,
        WorksController,
        BranchesController,
        VersionsController,
        ModelConfigsController,
        OutlineController,
        StoryPlanningController,
        StoryLedgerController,
        EntitiesController,
        MapsController,
        WorldbuildingController,
        HistoryController,
        CharactersController,
        ChangesController,
        ChapterGenerationController,
        BatchJobsController,
        ExportsController,
        SearchController,
      );
  }
}
