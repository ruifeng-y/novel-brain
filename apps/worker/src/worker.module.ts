import { Module } from "@nestjs/common";

import { AgentGrantStore } from "@novel-brain/db";
import { GoldenThreeRepository } from "@novel-brain/golden-three";

import { AgentGrantGuard, WorkerAgentGrantStore } from "./agent-runtime/agent-grant.guard";
import { AgentOrchestrator } from "./agent-runtime/agent-orchestrator";
import { AgentOrchestratorRepository } from "./agent-runtime/agent-orchestrator.repository";
import { BatchPlanTickProcessor } from "./batch-plan/batch-plan.processor";
import { BatchPlanChildQueue } from "./batch-plan/batch-plan-child.queue";
import { WorkerBatchPlanQueue } from "./batch-plan/batch-plan.queue";
import { WorkerBatchPlanRepository } from "./batch-plan/batch-plan.repository";
import { GenerationJobProcessor } from "./generation/generation.processor";
import { WorkerGenerationRepository } from "./generation/generation.repository";
import { AI_GATEWAY } from "./generation/generation.tokens";
import { WorkerGoldenThreeContextCompiler } from "./golden-three/golden-three-context.compiler";
import { GoldenThreeJobProcessor } from "./golden-three/golden-three.processor";
import {
  ByokAiGatewayFactory,
  isFakeGenerationOperation,
  resolveWorkerAiProviderMode,
} from "./generation/model-provider.factory";
import { WorkerService } from "./worker.service";
import { SummaryRebuildProcessor } from "./summaries/summary-rebuild.processor";
import { WorkerSummaryRepository } from "./summaries/summary.repository";
import { WritingActionProcessor } from "./writing-actions/writing-action.processor";

@Module({
  providers: [
    WorkerService,
    WorkerBatchPlanRepository,
    WorkerBatchPlanQueue,
    BatchPlanChildQueue,
    BatchPlanTickProcessor,
    AgentGrantGuard,
    AgentOrchestrator,
    {
      provide: AgentOrchestratorRepository,
      useFactory: () => new AgentOrchestratorRepository(),
    },
    {
      provide: AgentGrantStore,
      useClass: WorkerAgentGrantStore,
    },
    WorkerGenerationRepository,
    GenerationJobProcessor,
    WorkerGoldenThreeContextCompiler,
    {
      provide: GoldenThreeRepository,
      inject: [WorkerGoldenThreeContextCompiler],
      useFactory: (compiler: WorkerGoldenThreeContextCompiler) =>
        new GoldenThreeRepository(compiler),
    },
    GoldenThreeJobProcessor,
    WorkerSummaryRepository,
    SummaryRebuildProcessor,
    WritingActionProcessor,
    {
      provide: AI_GATEWAY,
      useFactory: () =>
        new ByokAiGatewayFactory({
          mode: resolveWorkerAiProviderMode(process.env),
          failOperations: (process.env.FAKE_AI_FAILURE_STEP ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(isFakeGenerationOperation),
        }),
    },
  ],
})
export class WorkerModule {}
