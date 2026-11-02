import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseRedisConnection } from '@novel/contracts';
import { AuthModule } from '../auth/auth.module';
import { AccountAuditModule } from '../audit/account-audit.module';
import { BranchStateModule } from '../branches/branch-state.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { DownloadTokenService } from './download-token.service';
import { DownloadsController } from './downloads.controller';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AccountAuditModule,
    BranchStateModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisConnection(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    BullModule.registerQueue({ name: 'export' }),
  ],
  controllers: [ExportsController, DownloadsController],
  providers: [ExportsService, DownloadTokenService],
})
export class ExportsModule {}
