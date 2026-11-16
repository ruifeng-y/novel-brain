import { summaryRebuildJobSchema } from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";
import { describe, expect, it, vi } from "vitest";

import { SummaryRebuildProcessor } from "../src/summaries/summary-rebuild.processor";

describe("summary rebuild outcomes", () => {
  it("returns failed when a persisted summary item build fails", async () => {
    const run = { id: uuidv7(), status: "running" };
    const item = { ordinal: 1, scopeId: uuidv7() };
    const repository = {
      withRunLock: vi.fn(async (_runId: string, operation: () => Promise<void>) => operation()),
      loadRun: vi.fn(async () => run),
      ensurePlan: vi.fn(async () => undefined),
      claimNextItem: vi.fn(async () => ({ run, item })),
      buildProjection: vi.fn(async () => {
        throw new Error("projection failed");
      }),
      commitItem: vi.fn(),
      failItem: vi.fn(async () => undefined),
    };
    const processor = new SummaryRebuildProcessor(repository as never);
    const job = summaryRebuildJobSchema.parse({
      jobType: "rebuild_summaries",
      runId: uuidv7(),
      workId: uuidv7(),
      branchId: uuidv7(),
      actorId: uuidv7(),
      idempotencyKey: "summary-outcome",
    });

    await expect(processor.process(job)).resolves.toBe("failed");
    expect(repository.failItem).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        item,
        code: "SUMMARY_REBUILD_FAILED",
      }),
    );
  });
});
