export type GenerationConcurrencyLimits = {
  global: number;
  perUser: number;
  perWork: number;
};

export class GenerationConcurrencyGate {
  private active = 0;
  private readonly activeJobIds = new Set<string>();
  private readonly activeByUser = new Map<string, number>();
  private readonly activeByWork = new Map<string, number>();

  constructor(private readonly limits: GenerationConcurrencyLimits) {}

  tryAcquire(userId: string, workId: string, jobId?: string): (() => void) | null {
    if (jobId && this.activeJobIds.has(jobId)) {
      return null;
    }
    const userActive = this.activeByUser.get(userId) ?? 0;
    const workActive = this.activeByWork.get(workId) ?? 0;
    if (
      this.active >= this.limits.global ||
      userActive >= this.limits.perUser ||
      workActive >= this.limits.perWork
    ) {
      return null;
    }

    this.active += 1;
    if (jobId) {
      this.activeJobIds.add(jobId);
    }
    this.activeByUser.set(userId, userActive + 1);
    this.activeByWork.set(workId, workActive + 1);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= 1;
      if (jobId) {
        this.activeJobIds.delete(jobId);
      }
      this.decrement(this.activeByUser, userId);
      this.decrement(this.activeByWork, workId);
    };
  }

  private decrement(counter: Map<string, number>, key: string): void {
    const next = (counter.get(key) ?? 1) - 1;
    if (next <= 0) {
      counter.delete(key);
      return;
    }
    counter.set(key, next);
  }
}
