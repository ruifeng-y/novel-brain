import { Injectable } from '@nestjs/common';
import { systemJobs } from '@novel/db';
import { DatabaseService } from './database/database.service';

export interface SystemJobStore {
  completeBootstrapPing(result: Record<string, unknown>): Promise<void>;
}

export const SYSTEM_JOB_STORE = Symbol('SYSTEM_JOB_STORE');
export const BOOTSTRAP_PING_JOB_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class DrizzleSystemJobStore implements SystemJobStore {
  constructor(private readonly database: DatabaseService) {}

  async completeBootstrapPing(result: Record<string, unknown>): Promise<void> {
    const now = new Date();
    await this.database.db
      .insert(systemJobs)
      .values({
        id: BOOTSTRAP_PING_JOB_ID,
        type: 'bootstrap-ping',
        status: 'completed',
        payload: { source: 'worker' },
        result,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemJobs.id,
        set: {
          status: 'completed',
          result,
          updatedAt: now,
        },
      });
  }
}
