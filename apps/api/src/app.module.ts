import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { ManuscriptImportModule } from "./imports/manuscript-import.module";
import { SettingsImportModule } from "./imports/settings-import.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { StoryBibleModule } from "./story-bible/story-bible.module";
import { WorksModule } from "./works/works.module";

@Module({
  imports: [
    AuthModule,
    HealthModule,
    ManuscriptImportModule,
    SettingsImportModule,
    ModelConfigModule,
    StoryBibleModule,
    WorksModule,
  ],
})
export class AppModule {}
