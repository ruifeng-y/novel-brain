import { Module } from "@nestjs/common";

import { AgentGrantStore } from "@novel-brain/db";

import { AgentGrantGuard, WorkerAgentGrantStore } from "./agent-runtime/agent-grant.guard";
import { GenerationJobProcessor } from "./generation/generation.processor";
import { WorkerGenerationRepository } from "./generation/generation.repository";
import { AI_GATEWAY } from "./generation/generation.tokens";
import {
  ByokAiGatewayFactory,
  resolveWorkerAiProviderMode,
} from "./generation/model-provider.factory";
import { WorkerService } from "./worker.service";

@Module({
  providers: [
    WorkerService,
    AgentGrantGuard,
    {
      provide: AgentGrantStore,
      useClass: WorkerAgentGrantStore,
    },
    WorkerGenerationRepository,
    GenerationJobProcessor,
    {
      provide: AI_GATEWAY,
      useFactory: () =>
        new ByokAiGatewayFactory({
          mode: resolveWorkerAiProviderMode(process.env),
          failOperations: (process.env.FAKE_AI_FAILURE_STEP ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter((value): value is "draft" | "verify" | "revise" =>
              ["draft", "verify", "revise"].includes(value),
            ),
        }),
    },
  ],
})
export class WorkerModule {}
