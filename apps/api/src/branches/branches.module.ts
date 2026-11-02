import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChangesModule } from '../changes/changes.module';
import { DatabaseModule } from '../database/database.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [DatabaseModule, AuthModule, ChangesModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
