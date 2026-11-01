import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WorksController],
  providers: [WorksService],
})
export class WorksModule {}
