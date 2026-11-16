import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { EXPORT_WORK_JOB, WORKER_QUEUE_NAME, type ExportWorkJob } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class WorkExportQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<ExportWorkJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<ExportWorkJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(payload: ExportWorkJob): Promise<void> {
    await this.queue.add(EXPORT_WORK_JOB, payload, {
      jobId: payload.jobId,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    if (this.connection.status === "ready") {
      await this.connection.quit();
    } else {
      this.connection.disconnect();
    }
  }
}
