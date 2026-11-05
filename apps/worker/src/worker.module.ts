import { Module } from "@nestjs/common";
import { FakeAiProvider } from "@novel-brain/ai";

import { GenerationJobProcessor } from "./generation/generation.processor";
import { WorkerGenerationRepository } from "./generation/generation.repository";
import { AI_GATEWAY } from "./generation/generation.tokens";
import { WorkerService } from "./worker.service";

@Module({
  providers: [
    WorkerService,
    WorkerGenerationRepository,
    GenerationJobProcessor,
    {
      provide: AI_GATEWAY,
      useFactory: () =>
        new FakeAiProvider({
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
