import { describe, expect, it } from 'vitest';
import { GenerationConcurrencyGate } from './generation-concurrency.gate';

describe('GenerationConcurrencyGate', () => {
  it('limits concurrent generation per user and per work while releasing both counters', () => {
    const gate = new GenerationConcurrencyGate({
      global: 4,
      perUser: 2,
      perWork: 2,
    });

    const first = gate.tryAcquire('user-a', 'work-a');
    const second = gate.tryAcquire('user-a', 'work-a');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire('user-a', 'work-a')).toBeNull();

    first?.();
    const third = gate.tryAcquire('user-a', 'work-a');
    expect(third).not.toBeNull();

    second?.();
    third?.();
    expect(gate.tryAcquire('user-a', 'work-a')).not.toBeNull();
  });

  it('keeps the global limit and treats different work branches independently', () => {
    const gate = new GenerationConcurrencyGate({
      global: 4,
      perUser: 3,
      perWork: 2,
    });

    const leases = [
      gate.tryAcquire('user-a', 'work-a'),
      gate.tryAcquire('user-a', 'work-a'),
      gate.tryAcquire('user-a', 'work-b'),
      gate.tryAcquire('user-b', 'work-c'),
    ];
    expect(leases.every((lease) => lease !== null)).toBe(true);
    expect(gate.tryAcquire('user-b', 'work-d')).toBeNull();

    leases.forEach((lease) => lease?.());
    expect(gate.tryAcquire('user-b', 'work-d')).not.toBeNull();
  });

  it('does not run two copies of the same resumed logical job at once', () => {
    const gate = new GenerationConcurrencyGate({
      global: 4,
      perUser: 2,
      perWork: 2,
    });

    const first = gate.tryAcquire('user-a', 'work-a', 'batch-job-1');
    expect(first).not.toBeNull();
    expect(gate.tryAcquire('user-a', 'work-a', 'batch-job-1')).toBeNull();
    expect(gate.tryAcquire('user-a', 'work-a', 'chapter-job-2')).not.toBeNull();

    first?.();
    expect(gate.tryAcquire('user-a', 'work-a', 'batch-job-1')).not.toBeNull();
  });
});
