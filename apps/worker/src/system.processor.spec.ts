import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { AccountPurgeRunner } from './accounts/account-purge.runner';
import { SystemProcessor } from './system.processor';
import type { SystemJobStore } from './system-job.store';

describe('SystemProcessor', () => {
  it('records a completed bootstrap ping', async () => {
    const store: SystemJobStore = {
      completeBootstrapPing: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new SystemProcessor(
      store,
      { run: vi.fn() } as unknown as AccountPurgeRunner,
    );

    const result = await processor.process({
      name: 'bootstrap-ping',
      data: { source: 'test' },
    } as Job<{ source: string }>);

    expect(result).toEqual({ ok: true });
    expect(store.completeBootstrapPing).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'test' }),
    );
  });

  it('dispatches the scheduled account purge', async () => {
    const store: SystemJobStore = {
      completeBootstrapPing: vi.fn().mockResolvedValue(undefined),
    };
    const run = vi.fn().mockResolvedValue({});
    const processor = new SystemProcessor(store, {
      run,
    } as unknown as AccountPurgeRunner);

    const result = await processor.process({
      name: 'account-purge',
      data: {},
    } as Job<Record<string, never>>);

    expect(result).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith({ limit: 100 });
  });
});
