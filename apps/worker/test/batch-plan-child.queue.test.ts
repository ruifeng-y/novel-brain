import { describe, expect, it } from "vitest";

import { batchPlanChildJobId } from "../src/batch-plan/batch-plan-child.queue";

const childJobId = "019c1e8c-8e1c-7000-8000-000000000004";

describe("batch plan child queue", () => {
  it("uses a BullMQ custom job id without reserved separators", () => {
    const queueJobId = batchPlanChildJobId(childJobId);

    expect(queueJobId).toBe(`batch-child-${childJobId}`);
    expect(queueJobId).not.toContain(":");
  });
});
