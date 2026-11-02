import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AI_GATEWAY, DeepSeekAiGateway, FakeAiGateway } from '@novel/ai';
import { parseRedisConnection } from '@novel/contracts';
import { DatabaseModule } from './database/database.module';
import { validateEnv } from './config/env';
import { ExportProcessor } from './exports/export.processor';
import { ExportRunner } from './exports/export.runner';
import { BatchGenerationRunner } from './generation/batch-generation.runner';
import { ChapterGenerationProcessor } from './generation/chapter-generation.processor';
import { ChapterGenerationRunner } from './generation/chapter-generation.runner';
import { GenerationModelConfigResolver } from './generation/generation-model-config.resolver';
import { SYSTEM_JOB_STORE, DrizzleSystemJobStore } from './system-job.store';
import { SystemProcessor } from './system.processor';
import { StorageModule } from './storage/storage.module';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisConnection(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    BullModule.registerQueue({ name: 'system' }),
    BullModule.registerQueue({ name: 'generation' }),
    BullModule.registerQueue({ name: 'export' }),
  ],
  providers: [
    SystemProcessor,
    WorkerBootstrapService,
    ChapterGenerationProcessor,
    BatchGenerationRunner,
    ChapterGenerationRunner,
    ExportProcessor,
    ExportRunner,
    GenerationModelConfigResolver,
    {
      provide: AI_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('AI_PROVIDER') === 'fake'
          ? new FakeAiGateway({
              mode: 'chapter',
              chunkSize: 80,
              delayMs: 12,
            })
          : new DeepSeekAiGateway(),
    },
    {
      provide: SYSTEM_JOB_STORE,
      useClass: DrizzleSystemJobStore,
    },
  ],
})
export class WorkerModule {}
