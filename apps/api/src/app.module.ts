import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { SettingsImportModule } from "./imports/settings-import.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { WorksModule } from "./works/works.module";

@Module({
  imports: [AuthModule, HealthModule, SettingsImportModule, ModelConfigModule, WorksModule],
})
export class AppModule {}
