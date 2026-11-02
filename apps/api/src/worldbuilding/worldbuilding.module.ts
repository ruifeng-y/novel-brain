import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { WorldbuildingController } from './worldbuilding.controller';
import { WorldbuildingService } from './worldbuilding.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WorldbuildingController],
  providers: [WorldbuildingService],
})
export class WorldbuildingModule {}
