import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccountAuditService } from './account-audit.service';

@Module({
  imports: [DatabaseModule],
  providers: [AccountAuditService],
  exports: [AccountAuditService],
})
export class AccountAuditModule {}
