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

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger;
  private readonly connection: Redis;
  private readonly queue: Queue<WorkerJob>;
  private readonly worker: BullWorker<WorkerJob, never>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }

    this.logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "worker" },
    });
    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.queue = new Queue<WorkerJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new BullWorker<WorkerJob, never>(
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

  private async processJob(job: Job<WorkerJob>): Promise<never> {
    const payload = workerJobSchema.parse(job.data);
    this.logger.warn(
      {
        event: "worker.job.execution_unavailable",
        jobId: payload.jobId,
        jobType: payload.jobType,
        checkpointStep: payload.checkpoint.step,
      },
      "Typed job received; durable execution belongs to a later ticket",
    );
    throw new Error("JOB_EXECUTION_NOT_IMPLEMENTED");
  }
}
