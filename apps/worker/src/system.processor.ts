import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SYSTEM_JOB_STORE, type SystemJobStore } from './system-job.store';
import { AccountPurgeRunner } from './accounts/account-purge.runner';
import { WorkPurgeRunner } from './works/work-purge.runner';

@Processor('system')
export class SystemProcessor extends WorkerHost {
  constructor(
    @Inject(SYSTEM_JOB_STORE) private readonly store: SystemJobStore,
    private readonly accountPurge: AccountPurgeRunner,
    private readonly workPurge: WorkPurgeRunner,
  ) {
    super();
  }

  async process(job: Job<{ source?: string }>): Promise<{ ok: boolean }> {
    if (job.name === 'account-purge') {
      await this.accountPurge.run({ limit: 100 });
      return { ok: true };
    }
    if (job.name === 'work-purge') {
      await this.workPurge.run({ limit: 100 });
      return { ok: true };
    }
    if (job.name === 'bootstrap-ping') {
      await this.store.completeBootstrapPing({
        source: job.data.source ?? 'unknown',
        processedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    throw new Error(`Unsupported system job: ${job.name}`);
  }
}
