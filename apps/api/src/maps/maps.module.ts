import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

@Module({
  imports: [DatabaseModule, AuthModule, StorageModule],
  controllers: [MapsController],
  providers: [MapsService],
})
export class MapsModule {}
