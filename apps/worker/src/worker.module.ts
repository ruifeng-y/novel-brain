import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { validateEnv } from './config/env';
import { SYSTEM_JOB_STORE, DrizzleSystemJobStore } from './system-job.store';
import { SystemProcessor } from './system.processor';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        },
      }),
    }),
    BullModule.registerQueue({ name: 'system' }),
  ],
  providers: [
    SystemProcessor,
    WorkerBootstrapService,
    {
      provide: SYSTEM_JOB_STORE,
      useClass: DrizzleSystemJobStore,
    },
  ],
})
export class WorkerModule {}
