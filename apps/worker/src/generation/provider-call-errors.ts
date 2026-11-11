export const BUDGET_EXHAUSTED_MESSAGE = "本次任务预算已用完，原稿和检查点已保留";
export const BUDGET_EXHAUSTED_ESCALATION = "预算已用完，请提高预算后从断点恢复";

export class JobStoppedError extends Error {
  constructor(readonly status: "paused" | "cancelled") {
    super(`Generation job is ${status}`);
    this.name = "JobStoppedError";
  }
}

export class ProviderBudgetExceededError extends Error {
  readonly failureClass = "budget" as const;

  constructor() {
    super(BUDGET_EXHAUSTED_MESSAGE);
    this.name = "ProviderBudgetExceededError";
  }
}

export class CostBudgetOverrunRecordedError extends Error {
  readonly failureClass = "budget" as const;

  constructor() {
    super("Actual model usage exceeded the reservation; the job was paused");
    this.name = "CostBudgetOverrunRecordedError";
  }
}
