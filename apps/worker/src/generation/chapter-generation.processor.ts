import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { BatchGenerationRunner } from './batch-generation.runner';
import { ChapterGenerationRunner } from './chapter-generation.runner';

export type ChapterGenerationJobData = {
  jobId: string;
};

@Processor('generation')
export class ChapterGenerationProcessor extends WorkerHost {
  constructor(
    private readonly runner: ChapterGenerationRunner,
    private readonly batchRunner: BatchGenerationRunner,
  ) {
    super();
  }

  async process(job: Job<ChapterGenerationJobData>): Promise<{ ok: boolean } | undefined> {
    if (job.name === 'generate-chapter') {
      return this.runner.run(job.data.jobId);
    }
    if (job.name === 'generate-batch') {
      return this.batchRunner.run(job.data.jobId);
    }
    throw new Error(`Unsupported generation job: ${job.name}`);
  }
}
