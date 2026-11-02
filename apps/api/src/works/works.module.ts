import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchStateModule } from '../branches/branch-state.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { VersionsModule } from '../versions/versions.module';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

@Module({
  imports: [DatabaseModule, AuthModule, BranchStateModule, VersionsModule, StorageModule],
  controllers: [WorksController],
  providers: [WorksService],
})
export class WorksModule {}
