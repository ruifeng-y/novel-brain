import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';

@Injectable()
export class WorkerBootstrapService implements OnApplicationBootstrap {
  constructor(@InjectQueue('system') private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      'bootstrap-ping',
      { source: 'worker' },
      {
        jobId: 'bootstrap-ping',
        removeOnComplete: 10,
        removeOnFail: 10,
      },
    );
  }
}
