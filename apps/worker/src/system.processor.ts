import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SYSTEM_JOB_STORE, type SystemJobStore } from './system-job.store';

@Processor('system')
export class SystemProcessor extends WorkerHost {
  constructor(@Inject(SYSTEM_JOB_STORE) private readonly store: SystemJobStore) {
    super();
  }

  async process(job: Job<{ source?: string }>): Promise<{ ok: boolean }> {
    if (job.name !== 'bootstrap-ping') {
      throw new Error(`Unsupported system job: ${job.name}`);
    }

    await this.store.completeBootstrapPing({
      source: job.data.source ?? 'unknown',
      processedAt: new Date().toISOString(),
    });
    return { ok: true };
  }
}
