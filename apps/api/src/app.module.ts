import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { CanonModule } from "./canon/canon.module";
import { ChaptersModule } from "./chapters/chapters.module";
import { CharactersModule } from "./characters/characters.module";
import { FactsModule } from "./facts/facts.module";
import { GenerationModule } from "./generation/generation.module";
import { HealthModule } from "./health/health.module";
import { ManuscriptImportModule } from "./imports/manuscript-import.module";
import { SettingsImportModule } from "./imports/settings-import.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { ReviewModule } from "./review/review.module";
import { SettingsModule } from "./settings/settings.module";
import { StoryBibleModule } from "./story-bible/story-bible.module";
import { WorksModule } from "./works/works.module";

@Module({
  imports: [
    AuthModule,
    CanonModule,
    ChaptersModule,
    CharactersModule,
    FactsModule,
    GenerationModule,
    HealthModule,
    ManuscriptImportModule,
    SettingsImportModule,
    ModelConfigModule,
    ReviewModule,
    SettingsModule,
    StoryBibleModule,
    WorksModule,
  ],
})
export class AppModule {}
