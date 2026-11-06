import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ConfirmedSettingsController } from "./confirmed-settings.controller";
import { CustomFieldsController } from "./custom-fields.controller";
import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuthModule],
  controllers: [SettingsController, ConfirmedSettingsController, CustomFieldsController],
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
