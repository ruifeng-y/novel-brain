import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AI_GATEWAY, DeepSeekAiGateway, FakeAiGateway } from '@novel/ai';
import { AuthModule } from '../auth/auth.module';
import { AccountAuditModule } from '../audit/account-audit.module';
import { DatabaseModule } from '../database/database.module';
import { DeepSeekConnectionTester, MODEL_CONNECTION_TESTER } from './model-connection-tester';
import { ModelConfigService } from './model-config.service';
import { ModelConfigsController } from './model-configs.controller';
import { ModelKeyCipher } from './model-key-cipher';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, AccountAuditModule],
  controllers: [ModelConfigsController],
  providers: [
    ModelConfigService,
    ModelKeyCipher,
    {
      provide: MODEL_CONNECTION_TESTER,
      useClass: DeepSeekConnectionTester,
    },
    {
      provide: AI_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('AI_PROVIDER') === 'fake'
          ? new FakeAiGateway()
          : new DeepSeekAiGateway(),
    },
  ],
  exports: [AI_GATEWAY, ModelConfigService],
})
export class AiModule {}
