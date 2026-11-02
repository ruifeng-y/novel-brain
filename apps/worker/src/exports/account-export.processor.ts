import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import { AccountExportRunner } from './account-export.runner';

export type AccountExportJobData = {
  exportId: string;
  userId: string;
};

@Processor('account-export')
export class AccountExportProcessor extends WorkerHost {
  constructor(
    private readonly database: DatabaseService,
    private readonly runner: AccountExportRunner,
  ) {
    super();
  }

  async process(job: Job<AccountExportJobData>): Promise<{ ok: boolean }> {
    if (!job.data.userId) {
      throw new Error(`Account export ${job.data.exportId} has no tenant context`);
    }
    return this.database.withUserContext(job.data.userId, () =>
      this.runner.run(job.data.exportId),
    );
  }
}
