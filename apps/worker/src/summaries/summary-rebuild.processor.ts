import { Injectable } from "@nestjs/common";
import type { SummaryRebuildJob, SummaryRecord } from "@novel-brain/contracts";
import type { RuntimeJobOutcome } from "@novel-brain/core";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerSummaryRepository } from "./summary.repository";

export interface SummaryCheckpointBoundary {
  runId: string;
  ordinal: number;
  scopeId: string;
  summary: SummaryRecord;
}

export type SummaryCheckpointBoundaryHook = (
  checkpoint: SummaryCheckpointBoundary,
) => void | Promise<void>;

@Injectable()
export class SummaryRebuildProcessor {
  private checkpointBoundaryHook: SummaryCheckpointBoundaryHook | undefined;

  constructor(private readonly repository: WorkerSummaryRepository) {}

  setCheckpointBoundaryHook(hook: SummaryCheckpointBoundaryHook | undefined): void {
    this.checkpointBoundaryHook = hook;
  }

  async process(job: SummaryRebuildJob): Promise<RuntimeJobOutcome> {
    let outcome: RuntimeJobOutcome = "succeeded";
    await this.repository.withRunLock(job.runId, async () => {
      const run = await this.repository.loadRun(job);
      if (!run) {
        outcome = "failed";
        return;
      }
      if (run.status === "completed") {
        return;
      }
      if (run.status === "cancelled") {
        outcome = "cancelled";
        return;
      }
      await this.repository.ensurePlan(run);
      while (true) {
        const claimed = await this.repository.claimNextItem(job.runId, job.actorId);
        if (!claimed) {
          return;
        }
        let summary: SummaryRecord;
        try {
          const projection = await this.repository.buildProjection(claimed.run, claimed.item);
          summary = await this.repository.commitItem({
            run: claimed.run,
            item: claimed.item,
            projection,
          });
        } catch (error) {
          await this.repository.failItem({
            run: claimed.run,
            item: claimed.item,
            code: "SUMMARY_REBUILD_FAILED",
            message: error instanceof Error ? error.message : "Summary rebuild failed",
          });
          outcome = "failed";
          return;
        }
        await this.checkpointBoundaryHook?.({
          runId: job.runId,
          ordinal: claimed.item.ordinal,
          scopeId: claimed.item.scopeId,
          summary,
        });
      }
    });
    return outcome;
  }
}
