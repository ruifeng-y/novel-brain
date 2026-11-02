import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseRedisConnection } from '@novel/contracts';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BatchJobsController } from './batch-jobs.controller';
import { BatchJobsService } from './batch-jobs.service';
import { ChapterGenerationController } from './chapter-generation.controller';
import { ChapterGenerationService } from './chapter-generation.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisConnection(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    BullModule.registerQueue({ name: 'generation' }),
  ],
  controllers: [ChapterGenerationController, BatchJobsController],
  providers: [ChapterGenerationService, BatchJobsService],
})
export class ChapterGenerationModule {}
