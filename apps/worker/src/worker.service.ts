import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  GENERATE_CHAPTER_JOB,
  WORKER_QUEUE_NAME,
  workerJobSchema,
  type WorkerJob,
} from "@novel-brain/contracts";
import { Queue, Worker as BullWorker, type Job } from "bullmq";
import Redis from "ioredis";
import pino, { type Logger } from "pino";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GenerationJobProcessor } from "./generation/generation.processor";

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger;
  private readonly connection: Redis;
  private readonly queue: Queue<WorkerJob>;
  private readonly worker: BullWorker<WorkerJob, void>;

  constructor(private readonly processor: GenerationJobProcessor) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }

    this.logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "worker" },
    });
    this.processor.setTraceLogger(this.logger);
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
      { event: "worker.ready", queue: WORKER_QUEUE_NAME, jobType: GENERATE_CHAPTER_JOB },
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
        jobId: payload.jobId,
        jobType: payload.jobType,
        checkpointStep: payload.checkpoint.step,
      },
      "Processing typed generation job",
    );
    await this.processor.process(payload);
  }
}
