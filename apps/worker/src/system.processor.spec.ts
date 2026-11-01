import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { SystemProcessor } from './system.processor';
import type { SystemJobStore } from './system-job.store';

describe('SystemProcessor', () => {
  it('records a completed bootstrap ping', async () => {
    const store: SystemJobStore = {
      completeBootstrapPing: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new SystemProcessor(store);

    const result = await processor.process({
      name: 'bootstrap-ping',
      data: { source: 'test' },
    } as Job<{ source: string }>);

    expect(result).toEqual({ ok: true });
    expect(store.completeBootstrapPing).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'test' }),
    );
  });
});
