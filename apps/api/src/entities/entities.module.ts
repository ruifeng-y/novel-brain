import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [EntitiesController],
  providers: [EntitiesService],
})
export class EntitiesModule {}
