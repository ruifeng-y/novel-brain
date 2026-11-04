import type { DependencyCheck, WorkerReadinessData } from "@novel-brain/contracts";

export interface WorkerReadinessInput {
  database: DependencyCheck;
  queue: DependencyCheck;
  workerCount: number;
}

export function evaluateWorkerReadiness(input: WorkerReadinessInput): WorkerReadinessData {
  const ready =
    input.database.status === "up" && input.queue.status === "up" && input.workerCount > 0;

  return {
    status: ready ? "ready" : "not_ready",
    service: "worker",
    workerCount: input.workerCount,
    checks: [input.database, input.queue],
  };
}
