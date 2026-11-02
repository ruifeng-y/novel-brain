export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'paused';

export type JobEvent =
  | 'start'
  | 'run'
  | 'waiting_review'
  | 'complete'
  | 'fail'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'retry';

export type JobTransition =
  { allowed: true; status: JobStatus } | { allowed: false; reason: string };

const TRANSITIONS: Record<JobStatus, Partial<Record<JobEvent, JobStatus>>> = {
  queued: {
    start: 'preparing',
    pause: 'paused',
    cancel: 'canceled',
  },
  preparing: {
    run: 'running',
    fail: 'failed',
    pause: 'paused',
    cancel: 'canceled',
  },
  running: {
    waiting_review: 'waiting_review',
    complete: 'completed',
    fail: 'failed',
    pause: 'paused',
    cancel: 'canceled',
  },
  waiting_review: {
    complete: 'completed',
    fail: 'failed',
    pause: 'paused',
    cancel: 'canceled',
  },
  paused: {
    resume: 'queued',
    cancel: 'canceled',
  },
  failed: {
    retry: 'queued',
    cancel: 'canceled',
  },
  completed: {},
  canceled: {},
};

export function transitionJobStatus(current: JobStatus, event: JobEvent): JobTransition {
  const next = TRANSITIONS[current][event];
  if (!next) {
    return {
      allowed: false,
      reason: `Cannot ${event} a ${current} job`,
    };
  }
  return { allowed: true, status: next };
}
