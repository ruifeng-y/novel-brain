import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import { ExportRunner } from './export.runner';

export type ExportJobData = {
  exportId: string;
  userId: string;
};

@Processor('export')
export class ExportProcessor extends WorkerHost {
  constructor(
    private readonly database: DatabaseService,
    private readonly runner: ExportRunner,
  ) {
    super();
  }

  async process(job: Job<ExportJobData>): Promise<{ ok: boolean }> {
    if (!job.data.userId) {
      throw new Error(`Export ${job.data.exportId} has no tenant context`);
    }
    return this.database.withUserContext(job.data.userId, () => this.runner.run(job.data.exportId));
  }
}
