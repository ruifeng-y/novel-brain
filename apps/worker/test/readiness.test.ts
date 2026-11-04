import type { DependencyCheck } from "@novel-brain/contracts";
import { describe, expect, it } from "vitest";

import { evaluateWorkerReadiness } from "../src/readiness";

const databaseUp: DependencyCheck = { name: "database", status: "up", latencyMs: 3 };
const queueUp: DependencyCheck = { name: "queue", status: "up", latencyMs: 4 };

describe("worker readiness", () => {
  it("is ready when database, queue and a consuming worker are present", () => {
    expect(
      evaluateWorkerReadiness({ database: databaseUp, queue: queueUp, workerCount: 1 }),
    ).toMatchObject({
      status: "ready",
      service: "worker",
      workerCount: 1,
    });
  });

  it("is not ready when no worker is consuming the queue", () => {
    expect(
      evaluateWorkerReadiness({ database: databaseUp, queue: queueUp, workerCount: 0 }),
    ).toMatchObject({
      status: "not_ready",
      workerCount: 0,
    });
  });

  it("is not ready when a dependency is down", () => {
    expect(
      evaluateWorkerReadiness({
        database: databaseUp,
        queue: { name: "queue", status: "down", latencyMs: 4 },
        workerCount: 1,
      }).status,
    ).toBe("not_ready");
  });
});
