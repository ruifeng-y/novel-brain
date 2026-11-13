import {
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
import { Queue, Worker as BullWorker, type Job } from "bullmq";
import Redis from "ioredis";
import pino, { type Logger } from "pino";

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

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger;
  private readonly connection: Redis;
  private readonly queue: Queue<WorkerJob>;
  private readonly worker: BullWorker<WorkerJob, void>;

  constructor(
    private readonly processor: GenerationJobProcessor,
    private readonly goldenThreeProcessor: GoldenThreeJobProcessor,
    private readonly batchPlanProcessor: BatchPlanTickProcessor,
    private readonly summaryProcessor: SummaryRebuildProcessor,
    private readonly writingActionProcessor: WritingActionProcessor,
  ) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }

    this.logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "worker" },
    });
    this.processor.setTraceLogger(this.logger);
    this.processor.configureRecovery({ maxAutomaticAttempts: 3 });
    this.writingActionProcessor.setTraceLogger(this.logger);
    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
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
    if (payload.jobType === SUMMARY_REBUILD_JOB) {
      await this.summaryProcessor.process(payload);
      return;
    }
    if (payload.jobType === BATCH_TICK_JOB) {
      await this.batchPlanProcessor.process(payload);
      return;
    }
    if (payload.jobType === WRITE_ACTION_JOB) {
      await this.writingActionProcessor.process(payload);
      return;
    }
    if (payload.jobType === GENERATE_GOLDEN_THREE_JOB) {
      await this.goldenThreeProcessor.process(payload);
      return;
    }
    await this.processor.process(payload);
    await this.batchPlanProcessor.onChildFinished(payload);
  }
}
