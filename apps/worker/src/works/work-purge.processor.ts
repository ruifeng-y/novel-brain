import { Inject, Injectable } from "@nestjs/common";
import { OBJECT_STORAGE, type ObjectStorage } from "@novel-brain/storage";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerWorkPurgeRepository } from "./work-purge.repository";

@Injectable()
export class WorkPurgeProcessor {
  constructor(
    private readonly repository: WorkerWorkPurgeRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async cleanupDue(): Promise<number> {
    let purged = 0;
    for (const workId of await this.repository.listDueWorkIds()) {
      try {
        const objectKeys = await this.repository.purge(workId);
        if (!objectKeys) {
          continue;
        }
        await this.storage.deleteObjects(objectKeys);
        purged += 1;
      } catch {
        // One blocked work must not stop the remaining due purge attempts.
      }
    }
    return purged;
  }
}
