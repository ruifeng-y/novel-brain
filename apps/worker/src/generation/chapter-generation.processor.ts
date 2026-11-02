import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { jobs } from '@novel/db';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { BatchGenerationRunner } from './batch-generation.runner';
import { ChapterGenerationRunner } from './chapter-generation.runner';
import { GenerationConcurrencyGate } from './generation-concurrency.gate';

export type ChapterGenerationJobData = {
  jobId: string;
  userId: string;
  workId?: string;
};

const WORKER_CONCURRENCY = Number.parseInt(process.env.WORKER_CONCURRENCY ?? '4', 10);
const GENERATION_DEFER_MS = Number.parseInt(process.env.GENERATION_DEFER_MS ?? '250', 10);

@Processor('generation', { concurrency: WORKER_CONCURRENCY })
export class ChapterGenerationProcessor extends WorkerHost {
  constructor(
    private readonly database: DatabaseService,
    private readonly runner: ChapterGenerationRunner,
    private readonly batchRunner: BatchGenerationRunner,
    private readonly gate: GenerationConcurrencyGate,
  ) {
    super();
  }

  async process(job: Job<ChapterGenerationJobData>): Promise<{ ok: boolean } | undefined> {
    if (!job.data.userId) {
      throw new Error(`Generation job ${job.id ?? job.data.jobId} has no tenant context`);
    }
    const workId = job.data.workId ?? (await this.lookupWorkId(job.data.jobId));
    const release = this.gate.tryAcquire(
      job.data.userId,
      workId ?? `job:${job.data.jobId}`,
      job.data.jobId,
    );
    if (!release) {
      await job.moveToDelayed(Date.now() + GENERATION_DEFER_MS, job.token);
      throw new DelayedError();
    }
    try {
      if (job.name === 'generate-chapter') {
        return await this.database.withUserContext(job.data.userId, () =>
          this.runner.run(job.data.jobId),
        );
      }
      if (job.name === 'generate-batch') {
        return await this.database.withUserContext(job.data.userId, () =>
          this.batchRunner.run(job.data.jobId),
        );
      }
      throw new Error(`Unsupported generation job: ${job.name}`);
    } finally {
      release();
    }
  }

  private async lookupWorkId(jobId: string): Promise<string | null> {
    const [row] = await this.database.db
      .select({ workId: jobs.workId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    return row?.workId ?? null;
  }
}
