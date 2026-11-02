import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
