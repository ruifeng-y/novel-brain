import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import {
  FakeModelConnectionTester,
  HttpModelConnectionTester,
  MODEL_CONNECTION_TESTER,
} from "./connection-tester";
import { ModelConfigController } from "./model-config.controller";
import { ModelConfigRepository } from "./model-config.repository";
import { ModelConfigService } from "./model-config.service";

@Module({
  imports: [AuthModule],
  controllers: [ModelConfigController],
  providers: [
    ModelConfigRepository,
    ModelConfigService,
    {
      provide: MODEL_CONNECTION_TESTER,
      useFactory: () =>
        process.env.MODEL_CONNECTION_TESTER === "fake"
          ? new FakeModelConnectionTester()
          : new HttpModelConnectionTester(),
    },
  ],
})
export class ModelConfigModule {}
