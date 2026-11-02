import { describe, expect, it } from 'vitest';
import { transitionJobStatus } from './job-state-machine';

describe('job state machine', () => {
  it('starts a queued job and moves through preparation into running work', () => {
    expect(transitionJobStatus('queued', 'start')).toEqual({
      allowed: true,
      status: 'preparing',
    });
    expect(transitionJobStatus('preparing', 'run')).toEqual({
      allowed: true,
      status: 'running',
    });
  });

  it('pauses active work and resumes it from the queue', () => {
    expect(transitionJobStatus('running', 'pause')).toEqual({
      allowed: true,
      status: 'paused',
    });
    expect(transitionJobStatus('paused', 'resume')).toEqual({
      allowed: true,
      status: 'queued',
    });
  });

  it('cancels a paused job but refuses to resume or cancel a completed job', () => {
    expect(transitionJobStatus('paused', 'cancel')).toEqual({
      allowed: true,
      status: 'canceled',
    });
    expect(transitionJobStatus('completed', 'resume').allowed).toBe(false);
    expect(transitionJobStatus('completed', 'cancel').allowed).toBe(false);
  });

  it('retries only failed jobs and returns them to the queue', () => {
    expect(transitionJobStatus('failed', 'retry')).toEqual({
      allowed: true,
      status: 'queued',
    });
    expect(transitionJobStatus('running', 'retry').allowed).toBe(false);
  });

  it('moves generated work into review and then completion', () => {
    expect(transitionJobStatus('running', 'waiting_review')).toEqual({
      allowed: true,
      status: 'waiting_review',
    });
    expect(transitionJobStatus('waiting_review', 'complete')).toEqual({
      allowed: true,
      status: 'completed',
    });
  });
});
