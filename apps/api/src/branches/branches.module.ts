import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChangesModule } from '../changes/changes.module';
import { DatabaseModule } from '../database/database.module';
import { VersionsModule } from '../versions/versions.module';
import { BranchStateModule } from './branch-state.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [DatabaseModule, AuthModule, ChangesModule, BranchStateModule, VersionsModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
