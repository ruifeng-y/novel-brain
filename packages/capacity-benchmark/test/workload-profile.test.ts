import { describe, expect, it } from "vitest";

import { REQUIRED_WORKLOAD_OPERATIONS, createWorkloadProfile } from "../src/workload-profile";

describe("capacity workload profile", () => {
  it("includes every required production operation class", () => {
    const profile = createWorkloadProfile({
      apiConcurrency: 4,
      durationSeconds: 60,
      rampSeconds: 10,
      workerConcurrency: { global: 4, perWork: 2, perUser: 2 },
    });

    expect(new Set(profile.operations.map((operation) => operation.id))).toEqual(
      new Set(REQUIRED_WORKLOAD_OPERATIONS),
    );
    expect(profile.decisionRequired).toContain("apiConcurrency");
    expect(profile.workerConcurrency).toEqual({ global: 4, perWork: 2, perUser: 2 });
  });

  it("keeps API concurrency independent from worker concurrency and rejects zero", () => {
    expect(() =>
      createWorkloadProfile({
        apiConcurrency: 5,
        durationSeconds: 60,
        rampSeconds: 10,
        workerConcurrency: { global: 4, perWork: 2, perUser: 2 },
      }),
    ).not.toThrow();
    expect(() =>
      createWorkloadProfile({
        apiConcurrency: 0,
        durationSeconds: 60,
        rampSeconds: 10,
        workerConcurrency: { global: 4, perWork: 2, perUser: 2 },
      }),
    ).toThrow("API_CONCURRENCY_INVALID");
  });
});
