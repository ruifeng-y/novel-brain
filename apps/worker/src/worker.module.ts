import { Module } from "@nestjs/common";

import { AgentGrantStore } from "@novel-brain/db";
import type { AiGateway } from "@novel-brain/ai";
import { GoldenThreeRepository } from "@novel-brain/golden-three";
import { createObjectStorageFromEnvironment, OBJECT_STORAGE } from "@novel-brain/storage";
import Redis from "ioredis";

import { AgentGrantGuard, WorkerAgentGrantStore } from "./agent-runtime/agent-grant.guard";
import { AccountPurgeProcessor } from "./account-lifecycle/account-purge.processor";
import { WorkerAccountPurgeRepository } from "./account-lifecycle/account-purge.repository";
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
import { WorkerOperationalMetricsRecorder } from "./metrics/operational-metrics-recorder";
import { WORKER_METRICS_REDIS, WORKER_REDIS } from "./metrics/operational-metrics.tokens";
import {
  ByokAiGatewayFactory,
  isFakeGenerationOperation,
  resolveWorkerAiProviderMode,
} from "./generation/model-provider.factory";
import { WorkerService } from "./worker.service";
import { SummaryRebuildProcessor } from "./summaries/summary-rebuild.processor";
import { WorkerSummaryRepository } from "./summaries/summary.repository";
import { WritingActionProcessor } from "./writing-actions/writing-action.processor";
import { WorkExportProcessor } from "./exports/work-export.processor";
import { WorkerWorkExportRepository } from "./exports/work-export.repository";

@Module({
  providers: [
    WorkerService,
    WorkerAccountPurgeRepository,
    AccountPurgeProcessor,
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
      provide: WORKER_REDIS,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error("REDIS_URL is required");
        }
        return new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
        });
      },
    },
    {
      provide: WORKER_METRICS_REDIS,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error("REDIS_URL is required");
        }
        return new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          enableReadyCheck: true,
        });
      },
    },
    {
      provide: WorkerOperationalMetricsRecorder,
      inject: [WORKER_METRICS_REDIS],
      useFactory: (redis: Redis) => new WorkerOperationalMetricsRecorder(redis),
    },
    {
      provide: GoldenThreeRepository,
      inject: [WorkerGoldenThreeContextCompiler, AI_GATEWAY, WorkerOperationalMetricsRecorder],
      useFactory: (
        compiler: WorkerGoldenThreeContextCompiler,
        resolver: AiGateway | Pick<ByokAiGatewayFactory, "create">,
        metrics: WorkerOperationalMetricsRecorder,
      ) =>
        new GoldenThreeRepository(
          compiler,
          {
            create: (config) => ("generateText" in resolver ? resolver : resolver.create(config)),
          },
          {
            modelCall: (observation) => metrics.recordModelAggregate(observation),
          },
        ),
    },
    GoldenThreeJobProcessor,
    WorkerSummaryRepository,
    SummaryRebuildProcessor,
    WritingActionProcessor,
    WorkerWorkExportRepository,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => createObjectStorageFromEnvironment(),
    },
    WorkExportProcessor,
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
