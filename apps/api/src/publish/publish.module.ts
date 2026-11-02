import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PublishController } from './publish.controller';
import { PublishService } from './publish.service';

@Module({
  imports: [DatabaseModule, AuthModule, AiModule],
  controllers: [PublishController],
  providers: [PublishService],
})
export class PublishModule {}
