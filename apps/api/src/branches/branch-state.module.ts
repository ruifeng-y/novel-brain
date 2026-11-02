import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BranchStateService } from './branch-state.service';

@Module({
  imports: [DatabaseModule],
  providers: [BranchStateService],
  exports: [BranchStateService],
})
export class BranchStateModule {}
