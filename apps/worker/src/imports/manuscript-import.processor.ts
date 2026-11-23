import { Injectable } from "@nestjs/common";
import type { ImportProcessJob } from "@novel-brain/contracts";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerManuscriptImportRepository } from "./manuscript-import.repository";

const MAX_CHUNKS_PER_JOB = 4_000;

@Injectable()
export class ManuscriptImportProcessor {
  constructor(private readonly repository: WorkerManuscriptImportRepository) {}

  async process(
    payload: ImportProcessJob,
    maxChunks = MAX_CHUNKS_PER_JOB,
  ): Promise<"succeeded" | "failed"> {
    const limit = Math.max(1, Math.min(MAX_CHUNKS_PER_JOB, maxChunks));
    for (let index = 0; index < limit; index += 1) {
      const delayMs = importProcessingDelayMs();
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const step = await this.repository.processNextChunk(payload.actorId, payload.importId);
      if (step.failed) {
        return "failed";
      }
      if (!step.continue) {
        return "succeeded";
      }
    }
    return "succeeded";
  }
}

function importProcessingDelayMs(): number {
  const value = Number(process.env.IMPORT_PROCESSING_DELAY_MS ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 5_000) : 0;
}
