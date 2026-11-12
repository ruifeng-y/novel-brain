import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { AgentRuntimeModule } from "./agent-runtime/agent-runtime.module";
import { BatchPlanModule } from "./batch-plan/batch-plan.module";
import { BatchReviewModule } from "./batch-review/batch-review.module";
import { CanonModule } from "./canon/canon.module";
import { ChaptersModule } from "./chapters/chapters.module";
import { ChangesModule } from "./changes/changes.module";
import { CharactersModule } from "./characters/characters.module";
import { FactsModule } from "./facts/facts.module";
import { GenerationModule } from "./generation/generation.module";
import { GoldenThreeModule } from "./golden-three/golden-three.module";
import { HealthModule } from "./health/health.module";
import { ManuscriptImportModule } from "./imports/manuscript-import.module";
import { SettingsImportModule } from "./imports/settings-import.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { NotificationModule } from "./notifications/notification.module";
import { OutlineModule } from "./outline/outline.module";
import { ReadinessModule } from "./readiness/readiness.module";
import { ReviewModule } from "./review/review.module";
import { RevisionModule } from "./revisions/revision.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { StoryBibleModule } from "./story-bible/story-bible.module";
import { StoryLedgerModule } from "./story-ledger/story-ledger.module";
import { StyleModule } from "./style/style.module";
import { SummariesModule } from "./summaries/summaries.module";
import { UsersModule } from "./users/users.module";
import { WorksModule } from "./works/works.module";
import { WorldModule } from "./world/world.module";
import { WritingActionModule } from "./writing-actions/writing-action.module";

@Module({
  imports: [
    AuthModule,
    AgentRuntimeModule,
    BatchPlanModule,
    BatchReviewModule,
    CanonModule,
    ChaptersModule,
    ChangesModule,
    CharactersModule,
    FactsModule,
    GenerationModule,
    GoldenThreeModule,
    HealthModule,
    ManuscriptImportModule,
    SettingsImportModule,
    ModelConfigModule,
    NotificationModule,
    OutlineModule,
    ReadinessModule,
    ReviewModule,
    RetrievalModule,
    SearchModule,
    SettingsModule,
    StoryBibleModule,
    StoryLedgerModule,
    StyleModule,
    SummariesModule,
    UsersModule,
    WorksModule,
    WorldModule,
    WritingActionModule,
    RevisionModule,
  ],
})
export class AppModule {}
