import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import { BatchGenerationRunner } from './batch-generation.runner';
import { ChapterGenerationRunner } from './chapter-generation.runner';

export type ChapterGenerationJobData = {
  jobId: string;
  userId: string;
};

@Processor('generation')
export class ChapterGenerationProcessor extends WorkerHost {
  constructor(
    private readonly database: DatabaseService,
    private readonly runner: ChapterGenerationRunner,
    private readonly batchRunner: BatchGenerationRunner,
  ) {
    super();
  }

  async process(job: Job<ChapterGenerationJobData>): Promise<{ ok: boolean } | undefined> {
    if (!job.data.userId) {
      throw new Error(`Generation job ${job.id ?? job.data.jobId} has no tenant context`);
    }
    if (job.name === 'generate-chapter') {
      return this.database.withUserContext(job.data.userId, () =>
        this.runner.run(job.data.jobId),
      );
    }
    if (job.name === 'generate-batch') {
      return this.database.withUserContext(job.data.userId, () =>
        this.batchRunner.run(job.data.jobId),
      );
    }
    throw new Error(`Unsupported generation job: ${job.name}`);
  }
}
