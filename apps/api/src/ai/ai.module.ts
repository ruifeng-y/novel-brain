import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import {
  DeepSeekConnectionTester,
  MODEL_CONNECTION_TESTER,
} from './model-connection-tester';
import { ModelConfigService } from './model-config.service';
import { ModelConfigsController } from './model-configs.controller';
import { ModelKeyCipher } from './model-key-cipher';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ModelConfigsController],
  providers: [
    ModelConfigService,
    ModelKeyCipher,
    {
      provide: MODEL_CONNECTION_TESTER,
      useClass: DeepSeekConnectionTester,
    },
  ],
  exports: [ModelConfigService],
})
export class AiModule {}
