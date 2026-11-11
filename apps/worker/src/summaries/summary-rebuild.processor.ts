import { Injectable } from "@nestjs/common";
import type { SummaryRebuildJob, SummaryRecord } from "@novel-brain/contracts";

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

  async process(job: SummaryRebuildJob): Promise<void> {
    await this.repository.withRunLock(job.runId, async () => {
      const run = await this.repository.loadRun(job);
      if (!run || run.status === "completed" || run.status === "cancelled") {
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
  }
}
