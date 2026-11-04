import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { WorksModule } from "./works/works.module";

@Module({
  imports: [AuthModule, HealthModule, ModelConfigModule, WorksModule],
})
export class AppModule {}
