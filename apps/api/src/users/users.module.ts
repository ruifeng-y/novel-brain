import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseRedisConnection } from '@novel/contracts';
import { AccountAuditModule } from '../account-audit/account-audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { AccountExportDownloadSigner } from './account-export-download.signer';
import { AccountExportsService } from './account-exports.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    AccountAuditModule,
    DatabaseModule,
    AuthModule,
    MailModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisConnection(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    BullModule.registerQueue({ name: 'account-export' }),
  ],
  controllers: [UsersController],
  providers: [UsersService, AccountExportsService, AccountExportDownloadSigner],
})
export class UsersModule {}
