import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { AgentRuntimeModule } from "./agent-runtime/agent-runtime.module";
import { CanonModule } from "./canon/canon.module";
import { ChaptersModule } from "./chapters/chapters.module";
import { CharactersModule } from "./characters/characters.module";
import { FactsModule } from "./facts/facts.module";
import { GenerationModule } from "./generation/generation.module";
import { GoldenThreeModule } from "./golden-three/golden-three.module";
import { HealthModule } from "./health/health.module";
import { ManuscriptImportModule } from "./imports/manuscript-import.module";
import { SettingsImportModule } from "./imports/settings-import.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { OutlineModule } from "./outline/outline.module";
import { ReviewModule } from "./review/review.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { SettingsModule } from "./settings/settings.module";
import { StoryBibleModule } from "./story-bible/story-bible.module";
import { StoryLedgerModule } from "./story-ledger/story-ledger.module";
import { SummariesModule } from "./summaries/summaries.module";
import { UsersModule } from "./users/users.module";
import { WorksModule } from "./works/works.module";
import { WorldModule } from "./world/world.module";

@Module({
  imports: [
    AuthModule,
    AgentRuntimeModule,
    CanonModule,
    ChaptersModule,
    CharactersModule,
    FactsModule,
    GenerationModule,
    GoldenThreeModule,
    HealthModule,
    ManuscriptImportModule,
    SettingsImportModule,
    ModelConfigModule,
    OutlineModule,
    ReviewModule,
    RetrievalModule,
    SettingsModule,
    StoryBibleModule,
    StoryLedgerModule,
    SummariesModule,
    UsersModule,
    WorksModule,
    WorldModule,
  ],
})
export class AppModule {}
