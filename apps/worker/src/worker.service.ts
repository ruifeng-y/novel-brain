import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  BATCH_TICK_JOB,
  GENERATE_CHAPTER_JOB,
  GENERATE_GOLDEN_THREE_JOB,
  SUMMARY_REBUILD_JOB,
  WORKER_QUEUE_NAME,
  WRITE_ACTION_JOB,
  workerJobSchema,
  type WorkerJob,
} from "@novel-brain/contracts";
import { emitTraceEnvelope, resolveTracePolicy, type TracePolicy } from "@novel-brain/core";
import { Queue, Worker as BullWorker, type Job } from "bullmq";
import type Redis from "ioredis";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GenerationJobProcessor } from "./generation/generation.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GoldenThreeJobProcessor } from "./golden-three/golden-three.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchPlanTickProcessor } from "./batch-plan/batch-plan.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SummaryRebuildProcessor } from "./summaries/summary-rebuild.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WritingActionProcessor } from "./writing-actions/writing-action.processor";
import { SafePinoLogger } from "./logging/safe-logger";
import {
  durableJobStatusToOutcome,
  isFinalJobAttempt,
  WorkerOperationalMetricsRecorder,
  type WorkerJobOutcome,
} from "./metrics/operational-metrics-recorder";
import { WORKER_REDIS } from "./metrics/operational-metrics.tokens";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerGenerationRepository } from "./generation/generation.repository";

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: SafePinoLogger;
  private readonly tracePolicy: TracePolicy;
  private readonly queue: Queue<WorkerJob>;
  private readonly worker: BullWorker<WorkerJob, void>;

  constructor(
    private readonly processor: GenerationJobProcessor,
    private readonly goldenThreeProcessor: GoldenThreeJobProcessor,
    private readonly batchPlanProcessor: BatchPlanTickProcessor,
    private readonly summaryProcessor: SummaryRebuildProcessor,
    private readonly writingActionProcessor: WritingActionProcessor,
    private readonly generationRepository: WorkerGenerationRepository,
    @Inject(WORKER_REDIS) private readonly connection: Redis,
    @Inject(WorkerOperationalMetricsRecorder)
    private readonly metrics: WorkerOperationalMetricsRecorder,
  ) {
    const tracePolicy = resolveTracePolicy(process.env);
    this.tracePolicy = tracePolicy;
    this.logger = new SafePinoLogger();
    this.logger.info({
      event: "worker.trace_policy",
      mode: tracePolicy.mode,
      retentionDays: tracePolicy.retentionDays,
      endpointConfigured: tracePolicy.endpoint !== null,
    });
    this.processor.setTraceLogger(this.logger);
    this.processor.configureRecovery({ maxAutomaticAttempts: 3 });
    this.writingActionProcessor.setTraceLogger(this.logger);
    this.logger.setTelemetrySink((payload) => {
      void this.metrics.recordModelCall(payload);
    });
    this.queue = new Queue<WorkerJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new BullWorker<WorkerJob, void>(
      WORKER_QUEUE_NAME,
      (job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 1,
        name: "novelbrain-worker",
      },
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await emitTraceEnvelope(this.tracePolicy, {
      name: "service.started",
      occurredAt: new Date().toISOString(),
      attributes: { service: "worker", event: "worker.ready" },
    });
    await this.queue.waitUntilReady();
    await this.worker.waitUntilReady();
    this.logger.info(
      {
        event: "worker.ready",
        queue: WORKER_QUEUE_NAME,
        jobTypes: [
          GENERATE_CHAPTER_JOB,
          GENERATE_GOLDEN_THREE_JOB,
          WRITE_ACTION_JOB,
          SUMMARY_REBUILD_JOB,
          BATCH_TICK_JOB,
        ],
      },
      "Worker is consuming its queue",
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    if (this.connection.status === "ready") {
      await this.connection.quit();
    } else {
      this.connection.disconnect();
    }
  }

  private async processJob(job: Job<WorkerJob>): Promise<void> {
    const payload = workerJobSchema.parse(job.data);
    this.logger.metric("worker.job.started", {
      job_type: payload.jobType,
      queue: WORKER_QUEUE_NAME,
    });
    this.logger.info(
      {
        event: "worker.job.started",
        jobType: payload.jobType,
        ...(payload.jobType === SUMMARY_REBUILD_JOB
          ? { runId: payload.runId }
          : payload.jobType === BATCH_TICK_JOB
            ? { planId: payload.planId }
            : payload.jobType === GENERATE_GOLDEN_THREE_JOB
              ? {
                  jobId: payload.jobId,
                  checkpointStep: payload.checkpoint.stepKey ?? payload.checkpoint.stage,
                }
              : { jobId: payload.jobId, checkpointStep: payload.checkpoint.step }),
      },
      "Processing typed worker job",
    );
    let outcome: WorkerJobOutcome | undefined;
    try {
      if (payload.jobType === SUMMARY_REBUILD_JOB) {
        outcome = await this.summaryProcessor.process(payload);
      } else if (payload.jobType === BATCH_TICK_JOB) {
        await this.batchPlanProcessor.process(payload);
      } else if (payload.jobType === WRITE_ACTION_JOB) {
        await this.writingActionProcessor.process(payload);
      } else if (payload.jobType === GENERATE_GOLDEN_THREE_JOB) {
        await this.goldenThreeProcessor.process(payload);
      } else {
        await this.processor.process(payload);
        await this.batchPlanProcessor.onChildFinished(payload);
      }
      if (!outcome) {
        outcome = await this.completedJobOutcome(payload);
      }
    } catch (error) {
      if (isFinalJobAttempt(job.attemptsMade, job.opts.attempts)) {
        outcome = "failed";
      }
      throw error;
    } finally {
      if (outcome) {
        void this.metrics.recordJob(payload.jobType, outcome);
      }
    }
  }

  private async completedJobOutcome(payload: WorkerJob): Promise<WorkerJobOutcome | undefined> {
    if (!("jobId" in payload) || !("actorId" in payload)) {
      return "succeeded";
    }
    try {
      return durableJobStatusToOutcome(
        await this.generationRepository.jobStatus({
          jobId: payload.jobId,
          userId: payload.actorId,
        }),
      );
    } catch {
      return undefined;
    }
  }
}
