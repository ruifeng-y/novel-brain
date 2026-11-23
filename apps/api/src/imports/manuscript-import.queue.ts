import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  PROCESS_IMPORT_JOB,
  WORKER_QUEUE_NAME,
  type ImportProcessJob,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class ManuscriptImportQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<ImportProcessJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<ImportProcessJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(actorId: string, importId: string, sequence: number): Promise<void> {
    const payload: ImportProcessJob = {
      jobType: PROCESS_IMPORT_JOB,
      importId,
      actorId,
      idempotencyKey: `manuscript-import-${importId}-${sequence}`,
    };
    await this.queue.add(PROCESS_IMPORT_JOB, payload, {
      jobId: payload.idempotencyKey,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
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
