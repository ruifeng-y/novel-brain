import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchStateModule } from '../branches/branch-state.module';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';
import { VersionCaptureInterceptor } from './version-capture.interceptor';
import { VersionGraphService } from './version-graph.service';
import { VersionsController } from './versions.controller';

@Module({
  imports: [DatabaseModule, AuthModule, BranchStateModule],
  controllers: [VersionsController],
  providers: [AuditService, VersionGraphService, VersionCaptureInterceptor],
  exports: [AuditService, VersionGraphService],
})
export class VersionsModule {}
