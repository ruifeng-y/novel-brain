import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  PROCESS_IMPORT_JOB,
  WORKER_QUEUE_NAME,
  type ChunkedImportProgress,
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

  async enqueue(actorId: string, importId: string, progress: ChunkedImportProgress): Promise<void> {
    const nextProcessSequence = Math.min(progress.processedChunks, progress.uploadedChunks);
    const payload: ImportProcessJob = {
      jobType: PROCESS_IMPORT_JOB,
      importId,
      workId: null,
      branchId: null,
      actorId,
      idempotencyKey: `manuscript-import-${importId}-${nextProcessSequence}-${progress.uploadedChunks}`,
      checkpoint: {
        schemaVersion: 1,
        revision: progress.uploadedChunks,
        nextProcessSequence,
        uploadedChunks: progress.uploadedChunks,
        processedChunks: progress.processedChunks,
      },
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
