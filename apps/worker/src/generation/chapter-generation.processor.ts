import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ChapterGenerationRunner } from './chapter-generation.runner';

export type ChapterGenerationJobData = {
  jobId: string;
};

@Processor('generation')
export class ChapterGenerationProcessor extends WorkerHost {
  constructor(private readonly runner: ChapterGenerationRunner) {
    super();
  }

  async process(job: Job<ChapterGenerationJobData>): Promise<{ ok: boolean } | undefined> {
    if (job.name !== 'generate-chapter') {
      throw new Error(`Unsupported generation job: ${job.name}`);
    }
    return this.runner.run(job.data.jobId);
  }
}
