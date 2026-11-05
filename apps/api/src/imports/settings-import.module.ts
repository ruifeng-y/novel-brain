import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SettingsImportController } from "./settings-import.controller";
import { SettingsImportRepository } from "./settings-import.repository";
import { SettingsImportService } from "./settings-import.service";
import { WorksModule } from "../works/works.module";

@Module({
  imports: [AuthModule, WorksModule],
  controllers: [SettingsImportController],
  providers: [SettingsImportRepository, SettingsImportService],
})
export class SettingsImportModule {}
