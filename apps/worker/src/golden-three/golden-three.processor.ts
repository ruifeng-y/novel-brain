import { Injectable } from "@nestjs/common";
import { GENERATE_GOLDEN_THREE_JOB, type GenerateGoldenThreeJob } from "@novel-brain/contracts";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GoldenThreeRepository } from "@novel-brain/golden-three";

@Injectable()
export class GoldenThreeJobProcessor {
  constructor(private readonly repository: GoldenThreeRepository) {}

  async process(payload: GenerateGoldenThreeJob): Promise<void> {
    if (payload.jobType !== GENERATE_GOLDEN_THREE_JOB) {
      throw new Error(`Unexpected golden three job type: ${payload.jobType}`);
    }
    const result = await this.repository.runQueuedGeneration(payload, {
      requestId: `worker:${payload.jobId}`,
      ip: "",
      userAgent: "novelbrain-worker",
    });
    if (result.kind === "not_found") {
      throw new Error("Golden three job is missing or outside the tenant boundary");
    }
  }
}
