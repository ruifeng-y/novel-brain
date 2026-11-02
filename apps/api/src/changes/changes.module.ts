import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ChangesController } from './changes.controller';
import { ChangesService } from './changes.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ChangesController],
  providers: [ChangesService],
  exports: [ChangesService],
})
export class ChangesModule {}
